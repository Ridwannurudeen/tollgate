import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_RPC_URL, ARC_USDC, arcTestnet } from "./chain";
import { FORUM_ADDRESSES } from "./forum";
import type { LicenseSettlementEvidence } from "./types";

export const FEE_ROUTER_ADDRESS = FORUM_ADDRESSES.feeRouterV1;
const SPLIT_REGISTRY_PATH = path.join(
  process.cwd(),
  "data",
  "fee-router-splits.json",
);
let splitRegistryLock: Promise<void> = Promise.resolve();

export const feeRouterV1Abi = [
  {
    type: "event",
    name: "SplitCreated",
    inputs: [
      { name: "splitId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "recipients", type: "address[]", indexed: false },
      { name: "bps", type: "uint16[]", indexed: false },
    ],
  },
  {
    type: "function",
    name: "splitCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "createSplit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipients", type: "address[]" },
      { name: "bps", type: "uint16[]" },
    ],
    outputs: [{ name: "splitId", type: "uint256" }],
  },
  {
    type: "function",
    name: "splitAt",
    stateMutability: "view",
    inputs: [{ name: "splitId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "recipients", type: "address[]" },
          { name: "bps", type: "uint16[]" },
          { name: "totalRouted", type: "uint256" },
          { name: "createdAt", type: "uint64" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "splitId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export const usdcRouterAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export type FeeRouterRouteOptions = {
  enabled?: boolean;
  privateKey?: Hex;
  publicClient?: PublicClient;
  walletClient?: WalletClient;
  splitRegistryPath?: string;
};

export type FeeRouterSplitView = {
  creator: Address;
  recipients: readonly Address[];
  bps: readonly number[];
  totalRouted: bigint;
  createdAt: bigint;
};

export type FeeRouterSplitRecord = {
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

export function createFeeRouterPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
}

function feeRouterEnabled(options: FeeRouterRouteOptions): boolean {
  return options.enabled ?? process.env.APERTURE_FEE_ROUTER_ENABLED === "1";
}

function feeRouterPrivateKey(options: FeeRouterRouteOptions): Hex {
  const privateKey =
    options.privateKey ??
    (process.env.APERTURE_FEE_ROUTER_PRIVATE_KEY as Hex | undefined) ??
    (process.env.FACILITATOR_PRIVATE_KEY as Hex | undefined);
  if (!privateKey) {
    throw new Error(
      "APERTURE_FEE_ROUTER_PRIVATE_KEY or FACILITATOR_PRIVATE_KEY is required when FeeRouter settlement is enabled.",
    );
  }
  return privateKey;
}

export function assertValidFeeRouterSplit(
  recipients: Address[],
  bps: number[],
): void {
  if (recipients.length === 0) {
    throw new Error("FeeRouter split needs at least one recipient.");
  }
  if (recipients.length !== bps.length) {
    throw new Error("FeeRouter recipients and bps length mismatch.");
  }
  const totalBps = bps.reduce((sum, value) => sum + value, 0);
  if (totalBps !== 10_000) {
    throw new Error(`FeeRouter bps must sum to 10000; got ${totalBps}.`);
  }
}

export async function readFeeRouterSplit(
  splitId: bigint,
  publicClient: PublicClient = createFeeRouterPublicClient(),
): Promise<FeeRouterSplitView> {
  const split = await publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "splitAt",
    args: [splitId],
  });

  return {
    creator: split.creator,
    recipients: split.recipients,
    bps: split.bps.map((value) => Number(value)),
    totalRouted: split.totalRouted,
    createdAt: split.createdAt,
  };
}

function isAddressString(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHexString(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]+$/.test(value);
}

function isFeeRouterSplitRegistry(
  value: unknown,
): value is FeeRouterSplitRegistry {
  if (!value || typeof value !== "object") return false;
  const splits = (value as Record<string, unknown>).splits;
  return (
    Array.isArray(splits) &&
    splits.every((split) => {
      if (!split || typeof split !== "object") return false;
      const record = split as Record<string, unknown>;
      return (
        isAddressString(record.wallet) &&
        typeof record.splitId === "string" &&
        Array.isArray(record.recipients) &&
        record.recipients.every(isAddressString) &&
        Array.isArray(record.bps) &&
        record.bps.every((bps) => typeof bps === "number") &&
        isHexString(record.createSplitTx) &&
        typeof record.createdAt === "string"
      );
    })
  );
}

export async function readFeeRouterSplitRegistry(
  filePath: string = SPLIT_REGISTRY_PATH,
): Promise<FeeRouterSplitRegistry> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isFeeRouterSplitRegistry(parsed) ? parsed : { splits: [] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { splits: [] };
    throw error;
  }
}

export async function writeFeeRouterSplitRegistry(
  registry: FeeRouterSplitRegistry,
  filePath: string = SPLIT_REGISTRY_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function withSplitRegistryLock<T>(write: () => Promise<T>): Promise<T> {
  const run = splitRegistryLock.then(write, write);
  splitRegistryLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function waitForFinalizedTransaction(
  publicClient: PublicClient,
  transactionHash: Hex,
  operation: "approve" | "createSplit" | "pay",
) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transactionHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`FeeRouter ${operation} transaction reverted.`);
  }
  if (receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) {
    throw new Error(
      `FeeRouter ${operation} transaction was replaced before confirmation.`,
    );
  }
  return receipt;
}

function createdSplitFromReceipt(
  receipt: Awaited<ReturnType<typeof waitForFinalizedTransaction>>,
  creator: Address,
  recipient: Address,
): bigint {
  const events = parseEventLogs({
    abi: feeRouterV1Abi,
    eventName: "SplitCreated",
    logs: receipt.logs,
  }).filter(
    (event) => event.address.toLowerCase() === FEE_ROUTER_ADDRESS.toLowerCase(),
  );
  if (events.length !== 1) {
    throw new Error(
      "FeeRouter createSplit receipt has no unique SplitCreated event.",
    );
  }

  const created = events[0].args;
  if (
    created.creator.toLowerCase() !== creator.toLowerCase() ||
    created.recipients.length !== 1 ||
    created.recipients[0]?.toLowerCase() !== recipient.toLowerCase() ||
    created.bps.length !== 1 ||
    Number(created.bps[0]) !== 10_000
  ) {
    throw new Error(
      "FeeRouter SplitCreated event does not match the requested creator split.",
    );
  }
  return created.splitId;
}

async function verifyCreatorSplit(
  record: FeeRouterSplitRecord,
  recipient: Address,
  publicClient: PublicClient,
): Promise<void> {
  const split = await readFeeRouterSplit(BigInt(record.splitId), publicClient);
  if (
    split.recipients.length !== 1 ||
    split.recipients[0]?.toLowerCase() !== recipient.toLowerCase() ||
    split.bps.length !== 1 ||
    split.bps[0] !== 10_000
  ) {
    throw new Error(
      `FeeRouter split ${record.splitId} does not match creator ${recipient}.`,
    );
  }
}

async function ensureCreatorSplit(
  recipient: Address,
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: ReturnType<typeof privateKeyToAccount>,
  registryPath: string = SPLIT_REGISTRY_PATH,
): Promise<FeeRouterSplitRecord> {
  assertValidFeeRouterSplit([recipient], [10_000]);
  return withSplitRegistryLock(async () => {
    const registry = await readFeeRouterSplitRegistry(registryPath);
    const existing = registry.splits.find(
      (split) => split.wallet.toLowerCase() === recipient.toLowerCase(),
    );
    if (existing) {
      await verifyCreatorSplit(existing, recipient, publicClient);
      return existing;
    }

    const { request } = await publicClient.simulateContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "createSplit",
      args: [[recipient], [10_000]],
      account: account.address,
      chain: arcTestnet,
    });
    // Serialized in-process; ops should run one FeeRouter settlement worker per app instance.
    const createSplitTx = await walletClient.writeContract({
      ...request,
      account,
    });
    const receipt = await waitForFinalizedTransaction(
      publicClient,
      createSplitTx,
      "createSplit",
    );
    const splitId = createdSplitFromReceipt(
      receipt,
      account.address,
      recipient,
    );

    const record: FeeRouterSplitRecord = {
      wallet: recipient,
      splitId: splitId.toString(),
      recipients: [recipient],
      bps: [10_000],
      createSplitTx,
      createdAt: new Date().toISOString(),
    };
    await writeFeeRouterSplitRegistry(
      { splits: [...registry.splits, record] },
      registryPath,
    );
    return record;
  });
}

export async function routeLicensePayment(
  recipient: Address,
  amountAtomicUsdc: number,
  options: FeeRouterRouteOptions = {},
): Promise<LicenseSettlementEvidence | null> {
  if (!feeRouterEnabled(options)) return null;
  if (amountAtomicUsdc <= 0) {
    throw new Error("License fee must be greater than zero.");
  }

  const account = privateKeyToAccount(feeRouterPrivateKey(options));
  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  const walletClient =
    options.walletClient ??
    createWalletClient({
      account,
      chain: arcTestnet,
      transport: http(ARC_RPC_URL),
    });
  const amount = BigInt(amountAtomicUsdc);

  const [balance, allowance] = await Promise.all([
    publicClient.readContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.readContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "allowance",
      args: [account.address, FEE_ROUTER_ADDRESS],
    }),
  ]);

  if (balance < amount) {
    throw new Error("FeeRouter payer has insufficient USDC asset balance.");
  }

  if (allowance < amount) {
    // Approve a bounded standing allowance (~100 payouts) so subsequent payouts
    // skip the approve tx (each payout was otherwise 2 txs: approve + pay),
    // while capping the FeeRouter's pull exposure on the payer key.
    const standingAllowance = amount * 100n;
    const approveTx = await walletClient.writeContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "approve",
      args: [FEE_ROUTER_ADDRESS, standingAllowance],
      account,
      chain: arcTestnet,
    });
    await waitForFinalizedTransaction(publicClient, approveTx, "approve");
  }

  const split = await ensureCreatorSplit(
    recipient,
    publicClient,
    walletClient,
    account,
    options.splitRegistryPath,
  );

  const payTx = await walletClient.writeContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "pay",
    args: [BigInt(split.splitId), amount],
    account,
    chain: arcTestnet,
  });
  await waitForFinalizedTransaction(publicClient, payTx, "pay");

  return {
    settlementMode: "forum-routed",
    payer: account.address,
    transaction: payTx,
    paymentResource: `forum-fee-router:${FEE_ROUTER_ADDRESS}`,
    feeRouterSplitId: split.splitId,
    feeRouterCreateSplitTx: split.createSplitTx,
    feeRouterPayTx: payTx,
  };
}
