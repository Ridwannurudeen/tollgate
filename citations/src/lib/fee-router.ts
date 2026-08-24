import path from "node:path";
import {
  ensureCreatorSplit,
  type FeeRouterSplitRecord,
} from "tollgate-pay-per-piece";
import { createFileSplitRegistryStore } from "tollgate-pay-per-piece/stores/file";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_RPC_URL, ARC_USDC, arcChain } from "./chain";
import { w3sExecuteContract } from "./circle-w3s";
import { FEE_ROUTER_ADDRESS, feeRouterV1Abi } from "./fee-router-contract";
import { withReservedNonce } from "./fee-router-nonce";
import type {
  Citation,
  CreatorSource,
  QueryRecord,
  ReceiptEvidence,
} from "./types";

export { assertValidFeeRouterSplit } from "tollgate-pay-per-piece";

const SPLIT_REGISTRY_PATH = path.join(
  process.cwd(),
  "data",
  "fee-router-splits.json",
);
const DEFAULT_FEE_ROUTER_TENANT_ID = "citations-core";
export const feeRouterSplitRegistryStore =
  createFileSplitRegistryStore(SPLIT_REGISTRY_PATH, {
    legacyTenantId: DEFAULT_FEE_ROUTER_TENANT_ID,
  });
const FEE_ROUTER_CLAIMABLE_CACHE_TTL_MS = 60_000;
const ARC_POLLING_INTERVAL_MS = 250;
// Approving the exact payout amount resets the allowance to ~0 after every pay,
// so concurrent payouts (demand engine + live queries) race a tiny allowance and
// revert with "transfer amount exceeds allowance". Instead top up to a large
// bounded standing allowance so many payouts clear without re-approving; actual
// spend stays capped by the payer wallet's USDC balance regardless of allowance.
export const STANDING_FEE_ROUTER_ALLOWANCE = 10_000_000_000n; // 10,000 USDC (atomic, 6dp)
type FeeRouterClaimableCacheEntry =
  | { value: bigint; fetchedAt: number }
  | { error: unknown; fetchedAt: number };
const feeRouterClaimableCache = new Map<string, FeeRouterClaimableCacheEntry>();

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
  tenantId?: string;
};

export type FeeRouterWriteContractRequest = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  account?: unknown;
  chain?: typeof arcChain;
  nonce?: number;
};

export type FeeRouterWalletClient = {
  writeContract(request: FeeRouterWriteContractRequest): Promise<Hex>;
};

export type FeeRouterSigner = {
  account: { address: Address };
  walletClient: FeeRouterWalletClient;
};

export type PlannedCitationPayment = {
  sourceId: string;
  citation: Citation;
  amountAtomicUsdc: number;
};

export type CitationPaymentPlan = {
  evidenceBySourceId: Record<string, ReceiptEvidence>;
  payments: PlannedCitationPayment[];
};

export function createFeeRouterPublicClient() {
  return createPublicClient({
    chain: arcChain,
    transport: http(ARC_RPC_URL),
    pollingInterval: ARC_POLLING_INTERVAL_MS,
  });
}

export async function waitForSuccessfulTransaction(
  publicClient: PublicClient,
  transaction: Hex,
  operation: string,
) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transaction,
  });
  if (receipt.transactionHash.toLowerCase() !== transaction.toLowerCase()) {
    throw new Error(`${operation} was replaced.`);
  }
  if (receipt.status !== "success") {
    throw new Error(`${operation} failed with status ${receipt.status}.`);
  }
  return receipt;
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

export async function readCachedFeeRouterClaimable(
  recipient: Address,
  publicClient?: PublicClient,
): Promise<bigint> {
  if (publicClient) return readFeeRouterClaimable(recipient, publicClient);
  const key = recipient.toLowerCase();
  const cached = feeRouterClaimableCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < FEE_ROUTER_CLAIMABLE_CACHE_TTL_MS) {
    if ("value" in cached) return cached.value;
    throw cached.error;
  }
  try {
    const value = await readFeeRouterClaimable(recipient);
    feeRouterClaimableCache.set(key, { value, fetchedAt: now });
    return value;
  } catch (error) {
    feeRouterClaimableCache.set(key, { error, fetchedAt: now });
    throw error;
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

export function feeRouterSettlementEnabled(
  options: FeeRouterRouteOptions,
): boolean {
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
          chain: arcChain,
          transport: http(ARC_RPC_URL),
          pollingInterval: ARC_POLLING_INTERVAL_MS,
        }),
      ),
  };
}

function normalizeFeeRouterTenantId(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : DEFAULT_FEE_ROUTER_TENANT_ID;
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

async function verifyStoredCreatorSplit(
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

function createdSplitFromReceipt(
  receipt: Awaited<ReturnType<typeof waitForSuccessfulTransaction>>,
  creator: Address,
  recipients: Address[],
  bps: number[],
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
    !sameAddressList(created.recipients, recipients) ||
    !sameBpsList(created.bps, bps)
  ) {
    throw new Error(
      "FeeRouter SplitCreated event does not match the requested split.",
    );
  }
  return created.splitId;
}

async function createCreatorSplit(
  recipients: Address[],
  bps: number[],
  publicClient: PublicClient,
  walletClient: FeeRouterWalletClient,
  account: { address: Address },
): Promise<{ splitId: bigint; txHash: Hex }> {
  const { request } = await publicClient.simulateContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "createSplit",
    args: [recipients, bps],
    account: account.address,
    chain: arcChain,
  });
  const txHash = await withReservedNonce(publicClient, account, (nonce) =>
    walletClient.writeContract({
      ...request,
      account,
      nonce,
    }),
  );
  const receipt = await waitForSuccessfulTransaction(
    publicClient,
    txHash,
    "FeeRouter createSplit transaction",
  );
  return {
    splitId: createdSplitFromReceipt(
      receipt,
      account.address,
      recipients,
      bps,
    ),
    txHash,
  };
}

function feeRouterTenantId(options: FeeRouterRouteOptions): string {
  return normalizeFeeRouterTenantId(options.tenantId);
}

function escrowUnverifiedEnabled(): boolean {
  return process.env.TOLLGATE_ESCROW_UNVERIFIED !== "0";
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

function payoutAmountForCitation(citation: Citation): number {
  const amount = citation.payoutAtomicUsdc ?? citation.amountAtomicUsdc;
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`Invalid payout amount for citation ${citation.sourceId}.`);
  }
  return amount;
}

function buildCitationPaymentPlan(
  query: QueryRecord,
  validatePayoutAmounts: boolean,
): CitationPaymentPlan {
  const evidenceBySourceId: Record<string, ReceiptEvidence> = {};
  const payments = query.citations.flatMap((citation) => {
    if (citation.payoutPolicy === "refund-unused") {
      evidenceBySourceId[citation.sourceId] = {
        settlementMode: "refunded",
        paymentResource: "tollgate-refund:unused-source",
        payoutPolicy: "refund-unused",
        refundReason: "Bought source was not cited in the final answer.",
      };
      return [];
    }
    if (shouldEscrowCitation(citation)) {
      evidenceBySourceId[citation.sourceId] = {
        settlementMode: "escrowed",
        paymentResource: "tollgate-escrow:unverified-source",
        payoutPolicy: "escrow-unverified",
      };
      return [];
    }
    return [
      {
        sourceId: citation.sourceId,
        citation,
        amountAtomicUsdc: validatePayoutAmounts
          ? payoutAmountForCitation(citation)
          : (citation.payoutAtomicUsdc ?? citation.amountAtomicUsdc),
      },
    ];
  });
  return { evidenceBySourceId, payments };
}

export function planCitationPayments(query: QueryRecord): CitationPaymentPlan {
  return buildCitationPaymentPlan(query, true);
}

export async function prepareCitationSplit(
  payment: PlannedCitationPayment,
  publicClient: PublicClient,
  walletClient: FeeRouterWalletClient,
  account: { address: Address },
  options: FeeRouterRouteOptions = {},
): Promise<FeeRouterSplitRecord> {
  const splitInput = splitForCitation(payment.citation);
  const store = options.splitRegistryPath
    ? createFileSplitRegistryStore(options.splitRegistryPath, {
        legacyTenantId: DEFAULT_FEE_ROUTER_TENANT_ID,
      })
    : feeRouterSplitRegistryStore;
  return ensureCreatorSplit(
    store,
    feeRouterTenantId(options),
    splitInput.wallet,
    splitInput.recipients,
    splitInput.bps,
    undefined,
    undefined,
    () =>
      createCreatorSplit(
        splitInput.recipients,
        splitInput.bps,
        publicClient,
        walletClient,
        account,
      ),
    (record) =>
      verifyStoredCreatorSplit(
        record,
        splitInput.recipients,
        splitInput.bps,
        publicClient,
      ),
  );
}

export async function routeCitationPayments(
  query: QueryRecord,
  options: FeeRouterRouteOptions = {},
): Promise<Record<string, ReceiptEvidence>> {
  const enabled = feeRouterSettlementEnabled(options);
  const { evidenceBySourceId, payments } = buildCitationPaymentPlan(
    query,
    enabled,
  );

  if (!enabled || payments.length === 0) {
    return evidenceBySourceId;
  }

  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  const { account, walletClient } = createFeeRouterSigner(options);
  const totalAtomicUsdc = payments.reduce(
    (sum, payment) => sum + BigInt(payment.amountAtomicUsdc),
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
    const approveTx = await withReservedNonce(publicClient, account, (nonce) =>
      walletClient.writeContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "approve",
        args: [FEE_ROUTER_ADDRESS, STANDING_FEE_ROUTER_ALLOWANCE],
        account,
        chain: arcChain,
        nonce,
      }),
    );
    await waitForSuccessfulTransaction(
      publicClient,
      approveTx,
      "FeeRouter approval transaction",
    );
  }

  // Payouts run together rather than one round-trip after another;
  // withReservedNonce serialises nonce allocation and caps how many submissions
  // are in flight, and the split store claims each identity, so the only thing
  // the sequential loop was still buying was latency. allSettled rather than
  // Promise.all: a rejection must not return while sibling payouts are still
  // unconfirmed, or a creator is paid on-chain with nothing recording it.
  const settlements = await Promise.allSettled(
    payments.map(async (payment) => {
      const split = await prepareCitationSplit(
        payment,
        publicClient,
        walletClient,
        account,
        options,
      );

      const payTx = await withReservedNonce(publicClient, account, (nonce) =>
        walletClient.writeContract({
          address: FEE_ROUTER_ADDRESS,
          abi: feeRouterV1Abi,
          functionName: "pay",
          args: [BigInt(split.splitId), BigInt(payment.amountAtomicUsdc)],
          account,
          chain: arcChain,
          nonce,
        }),
      );
      await waitForSuccessfulTransaction(
        publicClient,
        payTx,
        "FeeRouter pay transaction",
      );

      return { payment, split, payTx };
    }),
  );

  const failed = settlements.find(
    (settlement): settlement is PromiseRejectedResult =>
      settlement.status === "rejected",
  );
  if (failed) throw failed.reason;

  for (const settlement of settlements) {
    if (settlement.status !== "fulfilled") continue;
    const { payment, split, payTx } = settlement.value;
    evidenceBySourceId[payment.sourceId] = {
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
  if (!feeRouterSettlementEnabled(options)) {
    return {
      settlementMode: "local-proof",
      paymentResource: "tollgate-escrow:release-ready",
      payoutPolicy: "escrow-release",
      releasedReceiptHashes,
    };
  }

  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  const { account, walletClient } = createFeeRouterSigner(options);
  const tenantId = feeRouterTenantId(options);
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
    const approveTx = await withReservedNonce(publicClient, account, (nonce) =>
      walletClient.writeContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "approve",
        args: [FEE_ROUTER_ADDRESS, STANDING_FEE_ROUTER_ALLOWANCE],
        account,
        chain: arcChain,
        nonce,
      }),
    );
    await waitForSuccessfulTransaction(
      publicClient,
      approveTx,
      "FeeRouter escrow approval transaction",
    );
  }

  const recipients = source.contributors?.map(
    (contributor) => contributor.wallet,
  ) ?? [source.wallet];
  const bps = source.contributors?.map(
    (contributor) => contributor.shareBps,
  ) ?? [10_000];
  const store = options.splitRegistryPath
    ? createFileSplitRegistryStore(options.splitRegistryPath, {
        legacyTenantId: DEFAULT_FEE_ROUTER_TENANT_ID,
      })
    : feeRouterSplitRegistryStore;
  const split = await ensureCreatorSplit(
    store,
    tenantId,
    source.wallet,
    recipients,
    bps,
    undefined,
    undefined,
    () =>
      createCreatorSplit(
        recipients,
        bps,
        publicClient,
        walletClient,
        account,
      ),
    (record) => verifyStoredCreatorSplit(record, recipients, bps, publicClient),
  );
  const payTx = await withReservedNonce(publicClient, account, (nonce) =>
    walletClient.writeContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "pay",
      args: [BigInt(split.splitId), amount],
      account,
      chain: arcChain,
      nonce,
    }),
  );
  await waitForSuccessfulTransaction(
    publicClient,
    payTx,
    "FeeRouter escrow pay transaction",
  );

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

// Returns a reader's on-chain payment when a paid query is unanswerable (no
// registered source to cite). The refund is sent from the protocol's funded
// FeeRouter wallet — the agent-payee wallet that received the payment has no
// server-side key. Returns the tx hash, or null if refunds are not configured
// or the wallet can't cover it, so the caller keeps the honest answer either
// way and never crashes the query on a refund failure.
export async function refundReaderPayment(
  recipient: `0x${string}`,
  amountAtomicUsdc: number,
  options: FeeRouterRouteOptions = {},
): Promise<Hex | null> {
  if (!feeRouterSettlementEnabled(options)) return null;
  if (!Number.isInteger(amountAtomicUsdc) || amountAtomicUsdc <= 0) return null;
  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  const { account, walletClient } = createFeeRouterSigner(options);
  const amount = BigInt(amountAtomicUsdc);
  const balance = (await publicClient.readContract({
    address: ARC_USDC,
    abi: usdcRouterAbi,
    functionName: "balanceOf",
    args: [account.address],
  })) as bigint;
  if (balance < amount) return null;
  const refundTx = await withReservedNonce(publicClient, account, (nonce) =>
    walletClient.writeContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "transfer",
      args: [recipient, amount],
      account,
      chain: arcChain,
      nonce,
    }),
  );
  await waitForSuccessfulTransaction(
    publicClient,
    refundTx,
    "FeeRouter refund transaction",
  );
  return refundTx;
}
