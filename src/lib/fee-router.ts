import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_RPC_URL, ARC_USDC, arcTestnet } from "./chain";
import { FORUM_ADDRESSES } from "./forum";
import type { QueryRecord, ReceiptEvidence } from "./types";

export const FEE_ROUTER_ADDRESS = FORUM_ADDRESSES.feeRouterV1;

export const feeRouterV1Abi = [
  {
    type: "function",
    name: "splitCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalClaimableOf",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claimableOf",
    stateMutability: "view",
    inputs: [
      { name: "splitId", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }],
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

export async function routeCitationPayments(
  query: QueryRecord,
  options: FeeRouterRouteOptions = {},
): Promise<Record<string, ReceiptEvidence>> {
  if (!feeRouterEnabled(options)) return {};
  if (query.citations.length === 0) return {};

  const account = privateKeyToAccount(feeRouterPrivateKey(options));
  const publicClient = createFeeRouterPublicClient();
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
  const totalAtomicUsdc = query.citations.reduce(
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

  const evidenceBySourceId: Record<string, ReceiptEvidence> = {};
  for (const citation of query.citations) {
    assertValidFeeRouterSplit([citation.wallet], [10_000]);
    const splitId = await publicClient.readContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "splitCount",
    });
    const createSplitTx = await walletClient.writeContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "createSplit",
      args: [[citation.wallet], [10_000]],
      account,
      chain: arcTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash: createSplitTx });

    const payTx = await walletClient.writeContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "pay",
      args: [splitId, BigInt(citation.amountAtomicUsdc)],
      account,
      chain: arcTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash: payTx });

    evidenceBySourceId[citation.sourceId] = {
      settlementMode: "forum-routed",
      payer: account.address,
      transaction: payTx,
      paymentResource: `forum-fee-router:${FEE_ROUTER_ADDRESS}`,
      feeRouterSplitId: splitId.toString(),
      feeRouterCreateSplitTx: createSplitTx,
      feeRouterPayTx: payTx,
    };
  }

  return evidenceBySourceId;
}
