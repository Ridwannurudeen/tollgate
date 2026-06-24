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
import type { LicenseSettlementEvidence } from "./types";

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

export type FeeRouterRouteOptions = {
  enabled?: boolean;
  privateKey?: Hex;
  publicClient?: PublicClient;
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
    (process.env.APERTURE_FEE_ROUTER_PRIVATE_KEY as Hex | undefined);
  if (!privateKey) {
    throw new Error(
      "APERTURE_FEE_ROUTER_PRIVATE_KEY is required when FeeRouter settlement is enabled.",
    );
  }
  return privateKey;
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
  const walletClient = createWalletClient({
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

  const splitId = await publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "splitCount",
  });
  const createSplitTx = await walletClient.writeContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "createSplit",
    args: [[recipient], [10_000]],
    account,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash: createSplitTx });

  const payTx = await walletClient.writeContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "pay",
    args: [splitId, amount],
    account,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash: payTx });

  return {
    settlementMode: "forum-routed",
    payer: account.address,
    transaction: payTx,
    paymentResource: `forum-fee-router:${FEE_ROUTER_ADDRESS}`,
    feeRouterSplitId: splitId.toString(),
    feeRouterCreateSplitTx: createSplitTx,
    feeRouterPayTx: payTx,
  };
}
