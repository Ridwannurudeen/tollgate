import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
} from "viem";
import solc from "solc";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const BOT_ID =
  process.env.LEPTONWEB_SLASH_BOND_BOT_ID ??
  "0x434f104d66bd47acc44e9a77f3653075cbd18071da675682189101e96f316223";
const UNBOND_DELAY = BigInt(process.env.SLASHBOND_UNBOND_DELAY ?? "86400");
const BOND_AMOUNT = BigInt(process.env.SLASHBOND_BOND_AMOUNT ?? "1000");
const SLASH_AMOUNT = BigInt(process.env.SLASHBOND_SLASH_AMOUNT ?? "1");

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

const slashBondAbi = [
  {
    type: "constructor",
    inputs: [
      { name: "_usdc", type: "address" },
      { name: "_operator", type: "address" },
      { name: "_attestor", type: "address" },
      { name: "_recipient", type: "address" },
      { name: "_botId", type: "bytes32" },
      { name: "_unbondDelaySeconds", type: "uint64" },
    ],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "bond",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
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
];

const usdcAbi = [
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
];

function compileSlashBond(source) {
  const input = {
    language: "Solidity",
    sources: { "SlashBond.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors ?? [];
  const fatal = errors.filter((error) => error.severity === "error");
  if (fatal.length > 0) {
    throw new Error(fatal.map((error) => error.formattedMessage).join("\n"));
  }
  return `0x${output.contracts["SlashBond.sol"].SlashBond.evm.bytecode.object}`;
}

async function readStatus(publicClient, address) {
  const [bondBalance, totalSlashed] = await Promise.all([
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "bondBalance",
    }),
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "totalSlashed",
    }),
  ]);
  return {
    bondBalance: bondBalance.toString(),
    totalSlashed: totalSlashed.toString(),
  };
}

const roleId = process.env.LEPTONWEB_SLASH_BOND_ROLE ?? "demo-payer";
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
const source = await readFile(
  new URL("../../forum/src/SlashBond.sol", import.meta.url),
  "utf8",
);
const bytecode = compileSlashBond(source);
const walletBalance = await publicClient.readContract({
  address: ARC_USDC,
  abi: usdcAbi,
  functionName: "balanceOf",
  args: [wallet.address],
});

if (walletBalance < BOND_AMOUNT) {
  throw new Error("Demo wallet has insufficient Arc USDC to bond.");
}

const deployTx = await walletClient.deployContract({
  abi: slashBondAbi,
  bytecode,
  args: [
    ARC_USDC,
    wallet.address,
    wallet.address,
    wallet.address,
    BOT_ID,
    UNBOND_DELAY,
  ],
  account: wallet.account,
  chain: arcChain,
});
const deployReceipt = await publicClient.waitForTransactionReceipt({
  hash: deployTx,
});
if (!deployReceipt.contractAddress) {
  throw new Error("SlashBond deployment did not return a contract address.");
}

const allowance = await publicClient.readContract({
  address: ARC_USDC,
  abi: usdcAbi,
  functionName: "allowance",
  args: [wallet.address, deployReceipt.contractAddress],
});
let approveTx = null;
if (allowance < BOND_AMOUNT) {
  approveTx = await walletClient.writeContract({
    address: ARC_USDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [deployReceipt.contractAddress, BOND_AMOUNT],
    account: wallet.account,
    chain: arcChain,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
}

const bondTx = await walletClient.writeContract({
  address: deployReceipt.contractAddress,
  abi: slashBondAbi,
  functionName: "bond",
  args: [BOND_AMOUNT],
  account: wallet.account,
  chain: arcChain,
});
await publicClient.waitForTransactionReceipt({ hash: bondTx });

const statusBeforeSlash = await readStatus(
  publicClient,
  deployReceipt.contractAddress,
);
const reasonHash = keccak256(
  toHex(
    process.env.SLASHBOND_REASON ??
      `leptonweb bad citation proof ${new Date().toISOString()}`,
  ),
);
const slashTx = await walletClient.writeContract({
  address: deployReceipt.contractAddress,
  abi: slashBondAbi,
  functionName: "slash",
  args: [SLASH_AMOUNT, reasonHash],
  account: wallet.account,
  chain: arcChain,
});
await publicClient.waitForTransactionReceipt({ hash: slashTx });

const statusAfterSlash = await readStatus(
  publicClient,
  deployReceipt.contractAddress,
);
const evidence = {
  createdAt: new Date().toISOString(),
  role: wallet.id,
  caller: wallet.address,
  address: deployReceipt.contractAddress,
  deployTx,
  approveTx,
  bondTx,
  slashTx,
  reasonHash,
  botId: BOT_ID,
  bondAmountAtomicUsdc: BOND_AMOUNT.toString(),
  slashAmountAtomicUsdc: SLASH_AMOUNT.toString(),
  statusBeforeSlash,
  statusAfterSlash,
};
const evidencePath = new URL("../data/slashbond-demo.json", import.meta.url);
await mkdir(dirname(fileURLToPath(evidencePath)), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

console.log(JSON.stringify(evidence, null, 2));
