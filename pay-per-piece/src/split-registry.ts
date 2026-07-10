import type { Address, Hex, PublicClient } from "viem";
import {
  assertValidFeeRouterSplit,
  createSplit,
  readFeeRouterSplit,
  type FeeRouterSigner,
} from "./fee-router.js";

let splitRegistryLock: Promise<void> = Promise.resolve();
const MAX_TENANT_ID_LENGTH = 120;
const MAX_UINT256 = (1n << 256n) - 1n;

export type FeeRouterSplitRecord = {
  tenantId: string;
  wallet: Address;
  splitId: string;
  recipients: Address[];
  bps: number[];
  createSplitTx: Hex;
  createdAt: string;
};

export type FeeRouterSplitRegistry = {
  splits: FeeRouterSplitRecord[];
};

export type SplitRegistryStore = {
  read(): Promise<FeeRouterSplitRegistry>;
  write(registry: FeeRouterSplitRegistry): Promise<void>;
};

function isNonZeroAddressString(value: unknown): value is Address {
  return (
    typeof value === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(value) &&
    !/^0x0{40}$/i.test(value)
  );
}

function isTransactionHash(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function normalizeStoredTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const tenantId = value.trim();
  return tenantId && tenantId.length <= MAX_TENANT_ID_LENGTH ? tenantId : null;
}

function normalizeTenantId(value: string): string {
  const tenantId = value.trim();
  if (!tenantId) throw new Error("FeeRouter tenantId is required.");
  if (tenantId.length > MAX_TENANT_ID_LENGTH) {
    throw new Error(
      `FeeRouter tenantId must be ${MAX_TENANT_ID_LENGTH} characters or fewer.`,
    );
  }
  return tenantId;
}

function isUint256String(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d+$/.test(value) &&
    BigInt(value) <= MAX_UINT256
  );
}

export function parseFeeRouterSplitRegistry(
  value: unknown,
): FeeRouterSplitRegistry {
  if (!value || typeof value !== "object") return { splits: [] };
  const splits = (value as Record<string, unknown>).splits;
  if (!Array.isArray(splits)) return { splits: [] };
  return {
    splits: splits.flatMap((split) => {
      if (!split || typeof split !== "object") return [];
      const record = split as Record<string, unknown>;
      const tenantId = normalizeStoredTenantId(record.tenantId);
      if (
        tenantId &&
        isNonZeroAddressString(record.wallet) &&
        isUint256String(record.splitId) &&
        Array.isArray(record.recipients) &&
        record.recipients.length > 0 &&
        record.recipients.every(isNonZeroAddressString) &&
        Array.isArray(record.bps) &&
        record.recipients.length === record.bps.length &&
        record.bps.every(
          (bps) =>
            typeof bps === "number" &&
            Number.isInteger(bps) &&
            bps >= 0 &&
            bps <= 65_535,
        ) &&
        record.bps.reduce((sum, bps) => sum + bps, 0) === 10_000 &&
        isTransactionHash(record.createSplitTx) &&
        typeof record.createdAt === "string"
      ) {
        return [
          {
            tenantId,
            wallet: record.wallet,
            splitId: record.splitId,
            recipients: record.recipients,
            bps: record.bps,
            createSplitTx: record.createSplitTx,
            createdAt: record.createdAt,
          },
        ];
      }
      return [];
    }),
  };
}

function withSplitRegistryLock<T>(write: () => Promise<T>): Promise<T> {
  const run = splitRegistryLock.then(write, write);
  splitRegistryLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function sameAddressList(
  left: readonly Address[],
  right: readonly Address[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (address, index) => address.toLowerCase() === right[index]?.toLowerCase(),
    )
  );
}

function sameBpsList(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function ensureCreatorSplit(
  store: SplitRegistryStore,
  tenantIdInput: string,
  wallet: Address,
  recipients: Address[],
  bps: number[],
  signer: FeeRouterSigner,
  publicClient?: PublicClient,
): Promise<FeeRouterSplitRecord> {
  assertValidFeeRouterSplit(recipients, bps);
  if (!isNonZeroAddressString(wallet)) {
    throw new Error("FeeRouter wallet must be a non-zero EVM address.");
  }
  const tenantId = normalizeTenantId(tenantIdInput);
  return withSplitRegistryLock(async () => {
    const registry = await store.read();
    const existing = registry.splits.find(
      (split) =>
        split.tenantId === tenantId &&
        split.wallet.toLowerCase() === wallet.toLowerCase() &&
        sameAddressList(split.recipients, recipients) &&
        sameBpsList(split.bps, bps),
    );
    if (existing) {
      const split = await readFeeRouterSplit(
        BigInt(existing.splitId),
        publicClient,
      );
      if (
        !sameAddressList(split.recipients, recipients) ||
        !sameBpsList(split.bps, bps)
      ) {
        throw new Error(
          `FeeRouter split ${existing.splitId} does not match creator recipients.`,
        );
      }
      return existing;
    }

    const { splitId, txHash } = await createSplit(
      signer,
      recipients,
      bps,
      publicClient,
    );
    const record: FeeRouterSplitRecord = {
      tenantId,
      wallet,
      splitId: splitId.toString(),
      recipients,
      bps,
      createSplitTx: txHash,
      createdAt: new Date().toISOString(),
    };
    await store.write({ splits: [...registry.splits, record] });
    return record;
  });
}
