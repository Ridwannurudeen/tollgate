import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_RPC_URL, ARC_USDC, arcTestnet } from "./chain";
import { w3sExecuteContract } from "./circle-w3s";
import { FEE_ROUTER_ADDRESS, feeRouterV1Abi } from "./fee-router-contract";
import type {
  Citation,
  CreatorSource,
  QueryRecord,
  ReceiptEvidence,
} from "./types";

const SPLIT_REGISTRY_PATH = path.join(
  process.cwd(),
  "data",
  "fee-router-splits.json",
);
let splitRegistryLock: Promise<void> = Promise.resolve();

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

export type FeeRouterReadiness = {
  splitCount: bigint;
  payerAssetBalance: bigint;
  payerAllowance: bigint;
  recipientClaimable: bigint;
};

export type FeeRouterSplitView = {
  creator: Address;
  recipients: readonly Address[];
  bps: readonly number[];
  totalRouted: bigint;
  createdAt: bigint;
};

export type FeeRouterRouteOptions = {
  enabled?: boolean;
  privateKey?: Hex;
  publicClient?: PublicClient;
  walletClient?: FeeRouterWalletClient;
  splitRegistryPath?: string;
};

export type FeeRouterWriteContractRequest = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  account?: unknown;
  chain?: typeof arcTestnet;
};

export type FeeRouterWalletClient = {
  writeContract(request: FeeRouterWriteContractRequest): Promise<Hex>;
};

export type FeeRouterSigner = {
  account: { address: Address };
  walletClient: FeeRouterWalletClient;
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

export async function readFeeRouterReadiness(
  payer: Address,
  recipient: Address,
  publicClient: PublicClient = createFeeRouterPublicClient(),
): Promise<FeeRouterReadiness> {
  const [splitCount, payerAssetBalance, payerAllowance, recipientClaimable] =
    await Promise.all([
      publicClient.readContract({
        address: FEE_ROUTER_ADDRESS,
        abi: feeRouterV1Abi,
        functionName: "splitCount",
      }),
      publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "balanceOf",
        args: [payer],
      }),
      publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "allowance",
        args: [payer, FEE_ROUTER_ADDRESS],
      }),
      publicClient.readContract({
        address: FEE_ROUTER_ADDRESS,
        abi: feeRouterV1Abi,
        functionName: "totalClaimableOf",
        args: [recipient],
      }),
    ]);

  return {
    splitCount,
    payerAssetBalance,
    payerAllowance,
    recipientClaimable,
  };
}

export async function readFeeRouterClaimable(
  recipient: Address,
  publicClient: PublicClient = createFeeRouterPublicClient(),
): Promise<bigint> {
  return publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "totalClaimableOf",
    args: [recipient],
  });
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

function feeRouterEnabled(options: FeeRouterRouteOptions): boolean {
  return options.enabled ?? process.env.LEPTONWEB_FEE_ROUTER_ENABLED === "1";
}

function feeRouterPrivateKey(options: FeeRouterRouteOptions): Hex {
  const privateKey =
    options.privateKey ??
    (process.env.LEPTONWEB_FEE_ROUTER_PRIVATE_KEY as Hex | undefined);
  if (!privateKey) {
    throw new Error(
      "LEPTONWEB_FEE_ROUTER_PRIVATE_KEY is required when FeeRouter settlement is enabled.",
    );
  }
  return privateKey;
}

function feeRouterSignerMode(): "keystore" | "w3s" {
  const mode = process.env.TOLLGATE_SIGNER ?? "keystore";
  if (mode !== "keystore" && mode !== "w3s") {
    throw new Error("TOLLGATE_SIGNER must be keystore or w3s.");
  }
  return mode;
}

function requireW3SEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing`);
  return value;
}

function viemFeeRouterWalletClient(
  walletClient: WalletClient,
): FeeRouterWalletClient {
  type ViemWriteContractRequest = Parameters<WalletClient["writeContract"]>[0];
  return {
    writeContract: (request) =>
      walletClient.writeContract(request as ViemWriteContractRequest),
  };
}

function createW3SFeeRouterWalletClient(): FeeRouterSigner {
  const walletId = requireW3SEnv("CIRCLE_PAYER_WALLET_ID");
  const address = requireW3SEnv("CIRCLE_PAYER_ADDRESS") as Address;
  return {
    account: { address },
    walletClient: {
      writeContract: (request: FeeRouterWriteContractRequest) =>
        w3sExecuteContract({
          walletId,
          walletAddress: address,
          contractAddress: request.address,
          abi: request.abi,
          functionName: request.functionName,
          functionArgs: request.args,
        }),
    },
  };
}

export function createFeeRouterSigner(
  options: FeeRouterRouteOptions,
): FeeRouterSigner {
  if (feeRouterSignerMode() === "w3s" && !options.privateKey) {
    if (options.walletClient) {
      return {
        account: {
          address: requireW3SEnv("CIRCLE_PAYER_ADDRESS") as Address,
        },
        walletClient: options.walletClient,
      };
    }
    return createW3SFeeRouterWalletClient();
  }
  const account = privateKeyToAccount(feeRouterPrivateKey(options));
  return {
    account,
    walletClient:
      options.walletClient ??
      viemFeeRouterWalletClient(
        createWalletClient({
          account,
          chain: arcTestnet,
          transport: http(ARC_RPC_URL),
        }),
      ),
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

function sameAddressList(
  a: readonly Address[],
  b: readonly Address[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (address, index) => address.toLowerCase() === b[index]?.toLowerCase(),
    )
  );
}

function sameBpsList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function verifyCreatorSplit(
  record: FeeRouterSplitRecord,
  recipients: Address[],
  bps: number[],
  publicClient: PublicClient,
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

async function ensureCreatorSplit(
  wallet: Address,
  recipients: Address[],
  bps: number[],
  publicClient: PublicClient,
  walletClient: FeeRouterWalletClient,
  account: { address: Address },
  registryPath: string = SPLIT_REGISTRY_PATH,
): Promise<FeeRouterSplitRecord> {
  assertValidFeeRouterSplit(recipients, bps);
  return withSplitRegistryLock(async () => {
    const registry = await readFeeRouterSplitRegistry(registryPath);
    const existing = registry.splits.find(
      (split) =>
        split.wallet.toLowerCase() === wallet.toLowerCase() &&
        sameAddressList(split.recipients, recipients) &&
        sameBpsList(split.bps, bps),
    );
    if (existing) {
      await verifyCreatorSplit(existing, recipients, bps, publicClient);
      return existing;
    }

    const { result: splitId, request } = await publicClient.simulateContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "createSplit",
      args: [recipients, bps],
      account: account.address,
      chain: arcTestnet,
    });
    // Serialized in-process; ops should run one FeeRouter settlement worker per app instance.
    const createSplitTx = await walletClient.writeContract({
      ...request,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: createSplitTx });

    const record: FeeRouterSplitRecord = {
      wallet,
      splitId: splitId.toString(),
      recipients,
      bps,
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

function escrowUnverifiedEnabled(): boolean {
  return process.env.TOLLGATE_ESCROW_UNVERIFIED === "1";
}

function shouldEscrowCitation(citation: Citation): boolean {
  return (
    escrowUnverifiedEnabled() &&
    citation.sourceKind === "external" &&
    citation.verifiedCreator !== true
  );
}

function splitForCitation(citation: Citation): {
  wallet: Address;
  recipients: Address[];
  bps: number[];
} {
  if (citation.contributors && citation.contributors.length > 0) {
    return {
      wallet: citation.wallet,
      recipients: citation.contributors.map(
        (contributor) => contributor.wallet,
      ),
      bps: citation.contributors.map((contributor) => contributor.shareBps),
    };
  }
  return {
    wallet: citation.wallet,
    recipients: [citation.wallet],
    bps: [10_000],
  };
}

export async function routeCitationPayments(
  query: QueryRecord,
  options: FeeRouterRouteOptions = {},
): Promise<Record<string, ReceiptEvidence>> {
  if (query.citations.length === 0) return {};

  const evidenceBySourceId: Record<string, ReceiptEvidence> = {};
  const routeableCitations = query.citations.filter((citation) => {
    if (citation.payoutPolicy === "refund-unused") {
      evidenceBySourceId[citation.sourceId] = {
        settlementMode: "refunded",
        paymentResource: "tollgate-refund:unused-source",
        payoutPolicy: "refund-unused",
        refundReason: "Bought source was not cited in the final answer.",
      };
      return false;
    }
    if (!shouldEscrowCitation(citation)) return true;
    evidenceBySourceId[citation.sourceId] = {
      settlementMode: "escrowed",
      paymentResource: "tollgate-escrow:unverified-source",
      payoutPolicy: "escrow-unverified",
    };
    return false;
  });

  if (!feeRouterEnabled(options) || routeableCitations.length === 0) {
    return evidenceBySourceId;
  }

  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  const { account, walletClient } = createFeeRouterSigner(options);
  const totalAtomicUsdc = routeableCitations.reduce(
    (sum, citation) => sum + BigInt(citation.amountAtomicUsdc),
    0n,
  );
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

  if (balance < totalAtomicUsdc) {
    throw new Error("FeeRouter payer has insufficient USDC asset balance.");
  }

  if (allowance < totalAtomicUsdc) {
    const approveTx = await walletClient.writeContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "approve",
      args: [FEE_ROUTER_ADDRESS, totalAtomicUsdc],
      account,
      chain: arcTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  for (const citation of routeableCitations) {
    const splitInput = splitForCitation(citation);
    const split = await ensureCreatorSplit(
      splitInput.wallet,
      splitInput.recipients,
      splitInput.bps,
      publicClient,
      walletClient,
      account,
      options.splitRegistryPath,
    );

    const payTx = await walletClient.writeContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "pay",
      args: [BigInt(split.splitId), BigInt(citation.amountAtomicUsdc)],
      account,
      chain: arcTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash: payTx });

    evidenceBySourceId[citation.sourceId] = {
      settlementMode: "forum-routed",
      payer: account.address,
      transaction: payTx,
      paymentResource: `forum-fee-router:${FEE_ROUTER_ADDRESS}`,
      feeRouterSplitId: split.splitId,
      feeRouterCreateSplitTx: split.createSplitTx,
      feeRouterPayTx: payTx,
    };
  }

  return evidenceBySourceId;
}

export async function routeEscrowReleasePayment(
  source: CreatorSource,
  amountAtomicUsdc: number,
  releasedReceiptHashes: string[],
  options: FeeRouterRouteOptions = {},
): Promise<ReceiptEvidence> {
  if (!feeRouterEnabled(options)) {
    return {
      settlementMode: "local-proof",
      paymentResource: "tollgate-escrow:release-ready",
      payoutPolicy: "escrow-release",
      releasedReceiptHashes,
    };
  }

  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  const { account, walletClient } = createFeeRouterSigner(options);
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
    const approveTx = await walletClient.writeContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "approve",
      args: [FEE_ROUTER_ADDRESS, amount],
      account,
      chain: arcTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const recipients = source.contributors?.map(
    (contributor) => contributor.wallet,
  ) ?? [source.wallet];
  const bps = source.contributors?.map(
    (contributor) => contributor.shareBps,
  ) ?? [10_000];
  const split = await ensureCreatorSplit(
    source.wallet,
    recipients,
    bps,
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
  await publicClient.waitForTransactionReceipt({ hash: payTx });

  return {
    settlementMode: "forum-routed",
    payer: account.address,
    transaction: payTx,
    paymentResource: `forum-fee-router:${FEE_ROUTER_ADDRESS}`,
    feeRouterSplitId: split.splitId,
    feeRouterCreateSplitTx: split.createSplitTx,
    feeRouterPayTx: payTx,
    payoutPolicy: "escrow-release",
    releasedReceiptHashes,
  };
}
