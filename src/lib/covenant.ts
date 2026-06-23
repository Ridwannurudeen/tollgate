import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { ARC_RPC_URL, arcTestnet } from "./chain";
import { FORUM_ADDRESSES } from "./forum";
import { TOLLGATE_BOT_ID } from "./track-record";

export const COVENANT_FACTORY_ADDRESS = FORUM_ADDRESSES.covenantVaultFactory;
export const COVENANT_FACTORY_V2_ADDRESS =
  FORUM_ADDRESSES.covenantVaultFactoryV2;
export const RISK_KERNEL_V3_ADDRESS = FORUM_ADDRESSES.riskKernelV3;

export const covenantVaultFactoryAbi = [
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
] as const;

export const covenantVaultAbi = [
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
  {
    type: "function",
    name: "highWaterMark",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "operatorClaimable",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type CovenantMandate = {
  operator: Address;
  botId: Hex;
  budgetUsdc: bigint;
  maxDrawdownBps: number;
  receiptFreshnessSec: number;
  expiry: bigint;
  perfFeeBps: number;
  bondContract: Address;
  riskKernel: Address;
  trackRecordV2: Address;
};

export type CovenantVaultSnapshot = {
  address: Address;
  state: "ACTIVE" | "PAUSED";
  mandate: CovenantMandate;
  assets: bigint;
  idle: bigint;
  operatorOutstanding: bigint;
  availableCredit: bigint;
  totalShares: bigint;
  highWaterMark: bigint;
  operatorClaimable: bigint;
};

export type CovenantEnvelope = {
  botId: Hex;
  factory: Address;
  factoryV2: Address;
  vaultCount: bigint;
  botVaults: readonly Address[];
  latestVault: CovenantVaultSnapshot | null;
};

type MandateTuple = readonly [
  Address,
  Hex,
  bigint,
  number,
  number,
  bigint,
  number,
  Address,
  Address,
  Address,
];

export function createCovenantPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
}

export function covenantStateName(state: number): "ACTIVE" | "PAUSED" {
  if (state === 0) return "ACTIVE";
  if (state === 1) return "PAUSED";
  throw new Error(`Unknown CovenantVault state: ${state}.`);
}

function mandateFromTuple(mandate: MandateTuple): CovenantMandate {
  return {
    operator: mandate[0],
    botId: mandate[1],
    budgetUsdc: mandate[2],
    maxDrawdownBps: Number(mandate[3]),
    receiptFreshnessSec: Number(mandate[4]),
    expiry: mandate[5],
    perfFeeBps: Number(mandate[6]),
    bondContract: mandate[7],
    riskKernel: mandate[8],
    trackRecordV2: mandate[9],
  };
}

export async function readCovenantVaultSnapshot(
  address: Address,
  publicClient: PublicClient = createCovenantPublicClient(),
): Promise<CovenantVaultSnapshot> {
  const [
    mandate,
    state,
    assets,
    idle,
    operatorOutstanding,
    availableCredit,
    totalShares,
    highWaterMark,
    operatorClaimable,
  ] = await Promise.all([
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "mandate",
    }),
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "state",
    }),
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "assets",
    }),
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "depositTotalIdle",
    }),
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "operatorOutstanding",
    }),
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "availableCredit",
    }),
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "totalShares",
    }),
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "highWaterMark",
    }),
    publicClient.readContract({
      address,
      abi: covenantVaultAbi,
      functionName: "operatorClaimable",
    }),
  ]);

  return {
    address,
    state: covenantStateName(Number(state)),
    mandate: mandateFromTuple(mandate as MandateTuple),
    assets,
    idle,
    operatorOutstanding,
    availableCredit,
    totalShares,
    highWaterMark,
    operatorClaimable,
  };
}

export async function readCovenantEnvelope(
  botId: Hex = TOLLGATE_BOT_ID,
  publicClient: PublicClient = createCovenantPublicClient(),
): Promise<CovenantEnvelope> {
  const [vaultCount, botVaults] = await Promise.all([
    publicClient.readContract({
      address: COVENANT_FACTORY_ADDRESS,
      abi: covenantVaultFactoryAbi,
      functionName: "vaultCount",
    }),
    publicClient.readContract({
      address: COVENANT_FACTORY_ADDRESS,
      abi: covenantVaultFactoryAbi,
      functionName: "vaultsByBotId",
      args: [botId],
    }),
  ]);
  const latestVaultAddress = botVaults.at(-1);

  return {
    botId,
    factory: COVENANT_FACTORY_ADDRESS,
    factoryV2: COVENANT_FACTORY_V2_ADDRESS,
    vaultCount,
    botVaults,
    latestVault: latestVaultAddress
      ? await readCovenantVaultSnapshot(latestVaultAddress, publicClient)
      : null,
  };
}
