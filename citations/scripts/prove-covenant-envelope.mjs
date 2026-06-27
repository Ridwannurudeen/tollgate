import { createPublicClient, createWalletClient, http } from "viem";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const COVENANT_FACTORY = "0xc9bbafd02d22dd75a9f043f50f126ac2fe22ca26";
const TRACK_RECORD_V2 = "0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66";
const RISK_KERNEL_V3 = "0x554cdad3cac1f640b39816193310166afc2bde06";
const SLASH_BOND_V1_1 = "0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939";
const BOT_ID =
  process.env.LEPTONWEB_COVENANT_BOT_ID ??
  "0x434f104d66bd47acc44e9a77f3653075cbd18071da675682189101e96f316223";

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

const factoryAbi = [
  {
    type: "function",
    name: "vaultCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "vaultsByBotId",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "createVault",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "m",
        type: "tuple",
        components: [
          { name: "operator", type: "address" },
          { name: "botId", type: "bytes32" },
          { name: "budgetUsdc", type: "uint128" },
          { name: "maxDrawdownBps", type: "uint16" },
          { name: "receiptFreshnessSec", type: "uint32" },
          { name: "expiry", type: "uint64" },
          { name: "perfFeeBps", type: "uint16" },
          { name: "bondContract", type: "address" },
          { name: "riskKernel", type: "address" },
          { name: "trackRecordV2", type: "address" },
        ],
      },
    ],
    outputs: [{ type: "address" }],
  },
];

const vaultAbi = [
  {
    type: "function",
    name: "mandate",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "operator", type: "address" },
      { name: "botId", type: "bytes32" },
      { name: "budgetUsdc", type: "uint128" },
      { name: "maxDrawdownBps", type: "uint16" },
      { name: "receiptFreshnessSec", type: "uint32" },
      { name: "expiry", type: "uint64" },
      { name: "perfFeeBps", type: "uint16" },
      { name: "bondContract", type: "address" },
      { name: "riskKernel", type: "address" },
      { name: "trackRecordV2", type: "address" },
    ],
  },
  {
    type: "function",
    name: "state",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "function",
    name: "assets",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "depositTotalIdle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "operatorOutstanding",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "availableCredit",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalShares",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

function mandateFromTuple(mandate) {
  return {
    operator: mandate[0],
    botId: mandate[1],
    budgetUsdc: mandate[2].toString(),
    maxDrawdownBps: Number(mandate[3]),
    receiptFreshnessSec: Number(mandate[4]),
    expiry: mandate[5].toString(),
    perfFeeBps: Number(mandate[6]),
    bondContract: mandate[7],
    riskKernel: mandate[8],
    trackRecordV2: mandate[9],
  };
}

async function readVault(publicClient, address) {
  const [mandate, state, assets, idle, operatorOutstanding, availableCredit, totalShares] =
    await Promise.all([
      publicClient.readContract({
        address,
        abi: vaultAbi,
        functionName: "mandate",
      }),
      publicClient.readContract({
        address,
        abi: vaultAbi,
        functionName: "state",
      }),
      publicClient.readContract({
        address,
        abi: vaultAbi,
        functionName: "assets",
      }),
      publicClient.readContract({
        address,
        abi: vaultAbi,
        functionName: "depositTotalIdle",
      }),
      publicClient.readContract({
        address,
        abi: vaultAbi,
        functionName: "operatorOutstanding",
      }),
      publicClient.readContract({
        address,
        abi: vaultAbi,
        functionName: "availableCredit",
      }),
      publicClient.readContract({
        address,
        abi: vaultAbi,
        functionName: "totalShares",
      }),
    ]);

  return {
    address,
    state: Number(state) === 0 ? "ACTIVE" : "PAUSED",
    mandate: mandateFromTuple(mandate),
    assets: assets.toString(),
    idle: idle.toString(),
    operatorOutstanding: operatorOutstanding.toString(),
    availableCredit: availableCredit.toString(),
    totalShares: totalShares.toString(),
  };
}

const execute = process.env.COVENANT_EXECUTE === "1";
const roleId = process.env.LEPTONWEB_COVENANT_ROLE ?? "demo-payer";
const wallet = await loadWallet(roleId);
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});
const walletClient = createWalletClient({
  account: wallet.account,
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});
const budgetUsdc = BigInt(process.env.LEPTONWEB_COVENANT_BUDGET ?? "5000000");
const mandate = {
  operator: wallet.address,
  botId: BOT_ID,
  budgetUsdc,
  maxDrawdownBps: 500,
  receiptFreshnessSec: 1800,
  expiry: 0n,
  perfFeeBps: 0,
  bondContract: SLASH_BOND_V1_1,
  riskKernel: RISK_KERNEL_V3,
  trackRecordV2: TRACK_RECORD_V2,
};

let vaults = await publicClient.readContract({
  address: COVENANT_FACTORY,
  abi: factoryAbi,
  functionName: "vaultsByBotId",
  args: [BOT_ID],
});
let createTx = null;
if (vaults.length === 0 && execute) {
  createTx = await walletClient.writeContract({
    address: COVENANT_FACTORY,
    abi: factoryAbi,
    functionName: "createVault",
    args: [mandate],
    account: wallet.account,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash: createTx });
  vaults = await publicClient.readContract({
    address: COVENANT_FACTORY,
    abi: factoryAbi,
    functionName: "vaultsByBotId",
    args: [BOT_ID],
  });
}

const vaultCount = await publicClient.readContract({
  address: COVENANT_FACTORY,
  abi: factoryAbi,
  functionName: "vaultCount",
});
const latestVault = vaults.at(-1)
  ? await readVault(publicClient, vaults.at(-1))
  : null;

console.log(
  JSON.stringify(
    {
      execute,
      role: wallet.id,
      operator: wallet.address,
      factory: COVENANT_FACTORY,
      botId: BOT_ID,
      createTx,
      vaultCount: vaultCount.toString(),
      botVaults: vaults,
      latestVault,
      plannedMandate: !latestVault
        ? {
            ...mandate,
            budgetUsdc: mandate.budgetUsdc.toString(),
            expiry: mandate.expiry.toString(),
          }
        : null,
    },
    null,
    2,
  ),
);
