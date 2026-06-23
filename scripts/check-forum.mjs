import { createPublicClient, defineChain, http } from "viem";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const FORUM_REFERENCE_BOT_ID =
  "0x826d03b1edbf2c7251b6ff4a521c01cda6c01c1bf84cff2e39fc85b4edd4f6cd";

const FORUM_ADDRESSES = {
  feeRouterV1: "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59",
  slashBondV1_1: "0xe6c8c31477a1d88fbdad6e7b4fc83ab8e6e34939",
  trackRecordV2: "0x8f1c8fbf569146f32ddfb5b817bf2bd213840a66",
  covenantVaultFactory: "0xc9bbafd02d22dd75a9f043f50f126ac2fe22ca26",
};

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  testnet: true,
});

const feeRouterV1ReadAbi = [
  {
    type: "function",
    name: "splitCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

const slashBondReadAbi = [
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

const trackRecordV2ReadAbi = [
  {
    type: "function",
    name: "recordCount",
    stateMutability: "view",
    inputs: [{ name: "botId", type: "bytes32" }],
    outputs: [{ type: "uint256" }],
  },
];

const covenantVaultFactoryReadAbi = [
  {
    type: "function",
    name: "vaultCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

const chainId = await client.getChainId();
const contracts = await Promise.all(
  Object.entries(FORUM_ADDRESSES).map(async ([name, address]) => ({
    name,
    address,
    hasCode: Boolean(await client.getCode({ address })),
  })),
);

const [
  feeRouterSplitCount,
  trackRecordCount,
  slashBondBalance,
  slashBondTotalSlashed,
  covenantVaultCount,
] = await Promise.all([
  client.readContract({
    address: FORUM_ADDRESSES.feeRouterV1,
    abi: feeRouterV1ReadAbi,
    functionName: "splitCount",
  }),
  client.readContract({
    address: FORUM_ADDRESSES.trackRecordV2,
    abi: trackRecordV2ReadAbi,
    functionName: "recordCount",
    args: [FORUM_REFERENCE_BOT_ID],
  }),
  client.readContract({
    address: FORUM_ADDRESSES.slashBondV1_1,
    abi: slashBondReadAbi,
    functionName: "bondBalance",
  }),
  client.readContract({
    address: FORUM_ADDRESSES.slashBondV1_1,
    abi: slashBondReadAbi,
    functionName: "totalSlashed",
  }),
  client.readContract({
    address: FORUM_ADDRESSES.covenantVaultFactory,
    abi: covenantVaultFactoryReadAbi,
    functionName: "vaultCount",
  }),
]);

const result = {
  ok:
    chainId === ARC_CHAIN_ID && contracts.every((contract) => contract.hasCode),
  chainId,
  expectedChainId: ARC_CHAIN_ID,
  contracts,
  feeRouterSplitCount,
  trackRecordCount,
  slashBondBalance,
  slashBondTotalSlashed,
  covenantVaultCount,
};

console.log(
  JSON.stringify(
    result,
    (_key, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);

if (!result.ok) process.exit(1);
