import { createPublicClient, createWalletClient, http } from "viem";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const FEE_ROUTER_ADDRESS = "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59";

const arcChain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
};

const feeRouterClaimAbi = [
  {
    type: "function",
    name: "totalClaimableOf",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "amount", type: "uint256" }],
  },
];

const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

const roleId = process.env.LEPTONWEB_FEE_ROUTER_CLAIM_ROLE ?? "creator-primary";
const wallet = await loadWallet(roleId);
const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC_URL),
});
const walletClient = createWalletClient({
  account: wallet.account,
  chain: arcChain,
  transport: http(ARC_RPC_URL),
});

const [claimableBefore, balanceBefore] = await Promise.all([
  publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterClaimAbi,
    functionName: "totalClaimableOf",
    args: [wallet.address],
  }),
  publicClient.readContract({
    address: ARC_USDC,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [wallet.address],
  }),
]);

if (claimableBefore === 0n) {
  console.log(
    JSON.stringify(
      {
        role: wallet.id,
        recipient: wallet.address,
        feeRouter: FEE_ROUTER_ADDRESS,
        claimableBeforeAtomicUsdc: "0",
        claimed: false,
        reason: "No creator payout is currently claimable.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const claimTx = await walletClient.writeContract({
  address: FEE_ROUTER_ADDRESS,
  abi: feeRouterClaimAbi,
  functionName: "claim",
  account: wallet.account,
  chain: arcChain,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: claimTx });

const [claimableAfter, balanceAfter] = await Promise.all([
  publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterClaimAbi,
    functionName: "totalClaimableOf",
    args: [wallet.address],
  }),
  publicClient.readContract({
    address: ARC_USDC,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [wallet.address],
  }),
]);

console.log(
  JSON.stringify(
    {
      role: wallet.id,
      recipient: wallet.address,
      feeRouter: FEE_ROUTER_ADDRESS,
      claimTx,
      blockNumber: receipt.blockNumber.toString(),
      claimableBeforeAtomicUsdc: claimableBefore.toString(),
      claimableAfterAtomicUsdc: claimableAfter.toString(),
      balanceBeforeAtomicUsdc: balanceBefore.toString(),
      balanceAfterAtomicUsdc: balanceAfter.toString(),
      claimedDeltaAtomicUsdc: (balanceAfter - balanceBefore).toString(),
    },
    null,
    2,
  ),
);
