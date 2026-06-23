import { createPublicClient, createWalletClient, http, keccak256, toHex } from "viem";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const SLASH_BOND_ADDRESS =
  process.env.LEPTONWEB_SLASH_BOND_ADDRESS ??
  "0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939";

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
};

const slashBondAbi = [
  {
    type: "function",
    name: "operator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "attestor",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "recipient",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "botId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "bondBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSlashed",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unbondAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "unbondRequestedAt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
  },
  {
    type: "function",
    name: "slash",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "reason", type: "bytes32" },
    ],
    outputs: [],
  },
];

async function readStatus(publicClient) {
  const [
    operator,
    attestor,
    recipient,
    botId,
    bondBalance,
    totalSlashed,
    unbondAmount,
    unbondRequestedAt,
  ] = await Promise.all([
    publicClient.readContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "operator",
    }),
    publicClient.readContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "attestor",
    }),
    publicClient.readContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "recipient",
    }),
    publicClient.readContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "botId",
    }),
    publicClient.readContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "bondBalance",
    }),
    publicClient.readContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "totalSlashed",
    }),
    publicClient.readContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "unbondAmount",
    }),
    publicClient.readContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "unbondRequestedAt",
    }),
  ]);
  return {
    address: SLASH_BOND_ADDRESS,
    operator,
    attestor,
    recipient,
    botId,
    bondBalance: bondBalance.toString(),
    totalSlashed: totalSlashed.toString(),
    unbondAmount: unbondAmount.toString(),
    unbondRequestedAt: unbondRequestedAt.toString(),
  };
}

const roleId = process.env.LEPTONWEB_SLASH_BOND_ROLE ?? "demo-payer";
const execute = process.env.SLASHBOND_EXECUTE === "1";
const wallet = await loadWallet(roleId);
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});
const statusBefore = await readStatus(publicClient);

let slashTx = null;
let blockedReason = null;
if (execute) {
  if (statusBefore.attestor.toLowerCase() !== wallet.address.toLowerCase()) {
    blockedReason = "loaded wallet is not the SlashBond attestor";
  } else {
    const amount = BigInt(process.env.SLASHBOND_SLASH_AMOUNT ?? "1");
    const reason = keccak256(
      toHex(
        process.env.SLASHBOND_REASON ??
          `leptonweb slash proof ${new Date().toISOString()}`,
      ),
    );
    const walletClient = createWalletClient({
      account: wallet.account,
      chain: arcTestnet,
      transport: http(ARC_RPC_URL),
    });
    slashTx = await walletClient.writeContract({
      address: SLASH_BOND_ADDRESS,
      abi: slashBondAbi,
      functionName: "slash",
      args: [amount, reason],
      account: wallet.account,
      chain: arcTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash: slashTx });
  }
}

const statusAfter = slashTx ? await readStatus(publicClient) : statusBefore;

console.log(
  JSON.stringify(
    {
      execute,
      role: wallet.id,
      caller: wallet.address,
      canSlash: statusBefore.attestor.toLowerCase() === wallet.address.toLowerCase(),
      blockedReason,
      slashTx,
      statusBefore,
      statusAfter,
    },
    null,
    2,
  ),
);
