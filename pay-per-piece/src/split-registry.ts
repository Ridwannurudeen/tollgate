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

export type FeeRouterSplitKey = {
  tenantId: string;
  wallet: Address;
  recipients: Address[];
  bps: number[];
};

export type SplitRegistryGetOrInsertResult = {
  record: FeeRouterSplitRecord;
  inserted: boolean;
};

export type SplitRegistryStore = {
  read(): Promise<FeeRouterSplitRegistry>;
  write(registry: FeeRouterSplitRegistry): Promise<void>;
  getOrInsert?(
    key: FeeRouterSplitKey,
    insert: () => Promise<FeeRouterSplitRecord>,
  ): Promise<SplitRegistryGetOrInsertResult>;
};

export type CreateFeeRouterSplit = () => Promise<{
  splitId: bigint;
  txHash: Hex;
}>;

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

export function feeRouterSplitMatchesKey(
  split: FeeRouterSplitRecord,
  key: FeeRouterSplitKey,
): boolean {
  return (
    split.tenantId === key.tenantId &&
    split.wallet.toLowerCase() === key.wallet.toLowerCase() &&
    sameAddressList(split.recipients, key.recipients) &&
    sameBpsList(split.bps, key.bps)
  );
}

export function findFeeRouterSplit(
  registry: FeeRouterSplitRegistry,
  key: FeeRouterSplitKey,
): FeeRouterSplitRecord | undefined {
  return registry.splits.find((split) => feeRouterSplitMatchesKey(split, key));
}

async function verifyCreatorSplit(
  record: FeeRouterSplitRecord,
  recipients: Address[],
  bps: number[],
  publicClient?: PublicClient,
): Promise<void> {
  const split = await readFeeRouterSplit(BigInt(record.splitId), publicClient);
  if (
    !sameAddressList(split.recipients, recipients) ||
    !sameBpsList(split.bps, bps)
  ) {
    throw new Error(
      `FeeRouter split ${record.splitId} does not match creator recipients.`,
    );
  }
}

export async function ensureCreatorSplit(
  store: SplitRegistryStore,
  tenantIdInput: string,
  wallet: Address,
  recipients: Address[],
  bps: number[],
  signer: FeeRouterSigner,
  publicClient?: PublicClient,
  createCreatorSplit: CreateFeeRouterSplit = () =>
    createSplit(signer, recipients, bps, publicClient),
): Promise<FeeRouterSplitRecord> {
  assertValidFeeRouterSplit(recipients, bps);
  if (!isNonZeroAddressString(wallet)) {
    throw new Error("FeeRouter wallet must be a non-zero EVM address.");
  }
  const tenantId = normalizeTenantId(tenantIdInput);
  const key: FeeRouterSplitKey = { tenantId, wallet, recipients, bps };
  const insert = async (): Promise<FeeRouterSplitRecord> => {
    const { splitId, txHash } = await createCreatorSplit();
    return {
      tenantId,
      wallet,
      splitId: splitId.toString(),
      recipients,
      bps,
      createSplitTx: txHash,
      createdAt: new Date().toISOString(),
    };
  };

  if (store.getOrInsert) {
    const result = await store.getOrInsert(key, insert);
    if (!feeRouterSplitMatchesKey(result.record, key)) {
      throw new Error("FeeRouter split store returned a different identity.");
    }
    if (!result.inserted) {
      await verifyCreatorSplit(result.record, recipients, bps, publicClient);
    }
    return result.record;
  }

  return withSplitRegistryLock(async () => {
    const registry = await store.read();
    const existing = findFeeRouterSplit(registry, key);
    if (existing) {
      await verifyCreatorSplit(existing, recipients, bps, publicClient);
      return existing;
    }

    const record = await insert();
    await store.write({ splits: [...registry.splits, record] });
    return record;
  });
}
