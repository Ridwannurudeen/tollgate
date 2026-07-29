import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  isAddress,
} from "viem";
import solc from "solc";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const DEFAULT_AGENT_WALLET = "0x5C94b3aBb29c1dFcA24313B9A2D383960Cd69836";
const execute = process.env.USE_RECEIPT_REGISTRY_EXECUTE === "1";

const arcChain = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

const registryAbi = [
  {
    type: "constructor",
    inputs: [{ name: "agentWallet", type: "address" }],
    stateMutability: "nonpayable",
  },
];

function compileRegistry(source) {
  const input = {
    language: "Solidity",
    sources: { "UseReceiptRegistry.sol": { content: source } },
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
  const bytecode =
    output.contracts?.["UseReceiptRegistry.sol"]?.UseReceiptRegistry?.evm
      ?.bytecode?.object;
  if (!bytecode) throw new Error("UseReceiptRegistry compilation returned no bytecode.");
  return `0x${bytecode}`;
}

function agentWalletAddress() {
  const configured = process.env.LEPTONWEB_AGENT_WALLET ?? DEFAULT_AGENT_WALLET;
  if (!isAddress(configured)) {
    throw new Error("LEPTONWEB_AGENT_WALLET must be a 20-byte EVM address.");
  }
  return getAddress(configured);
}

const source = await readFile(
  new URL("../contracts/UseReceiptRegistry.sol", import.meta.url),
  "utf8",
);
const bytecode = compileRegistry(source);
const agentWallet = agentWalletAddress();

if (!execute) {
  console.log(
    JSON.stringify(
      {
        chainId: ARC_CHAIN_ID,
        rpcUrl: ARC_RPC_URL,
        agentWallet,
        bytecodeBytes: (bytecode.length - 2) / 2,
        execute: false,
        nextStep:
          "Set USE_RECEIPT_REGISTRY_EXECUTE=1 to deploy UseReceiptRegistry with the configured wallet role.",
      },
      null,
      2,
    ),
  );
} else {
  const role =
    process.env.LEPTONWEB_USE_INTENT_DEPLOYER_ROLE ?? "tollgate-agent-payee";
  const wallet = await loadWallet(role);
  const publicClient = createPublicClient({
    chain: arcChain,
    transport: http(ARC_RPC_URL),
  });
  const walletClient = createWalletClient({
    account: wallet.account,
    chain: arcChain,
    transport: http(ARC_RPC_URL),
  });
  const deployTx = await walletClient.deployContract({
    abi: registryAbi,
    bytecode,
    args: [agentWallet],
    account: wallet.account,
    chain: arcChain,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: deployTx,
  });
  if (!receipt.contractAddress) {
    throw new Error("UseReceiptRegistry deployment returned no contract address.");
  }
  console.log(
    JSON.stringify(
      {
        chainId: ARC_CHAIN_ID,
        deployerRole: role,
        deployer: wallet.address,
        agentWallet,
        address: receipt.contractAddress,
        deployTx,
        blockNumber: receipt.blockNumber.toString(),
      },
      null,
      2,
    ),
  );
}
