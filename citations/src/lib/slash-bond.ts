import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { ARC_RPC_URL, arcChain } from "./chain";
import { FORUM_ADDRESSES } from "./forum";

export const SLASH_BOND_ADDRESS = FORUM_ADDRESSES.slashBondV1_1;

export const slashBondAbi = [
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
    name: "unbondDelay",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint64" }],
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
] as const;

export type SlashBondStatus = {
  address: Address;
  operator: Address;
  attestor: Address;
  recipient: Address;
  botId: Hex;
  unbondDelay: bigint;
  bondBalance: bigint;
  totalSlashed: bigint;
  unbondAmount: bigint;
  unbondRequestedAt: bigint;
};

export type DemoSlashBondEvidence = {
  createdAt: string;
  role: string;
  caller: Address;
  address: Address;
  deployTx: Hex;
  approveTx: Hex | null;
  bondTx: Hex;
  slashTx: Hex;
  reasonHash: Hex;
  botId: Hex;
  bondAmountAtomicUsdc: string;
  slashAmountAtomicUsdc: string;
  statusBeforeSlash: {
    bondBalance: string;
    totalSlashed: string;
  };
  statusAfterSlash: {
    bondBalance: string;
    totalSlashed: string;
  };
};

const SLASH_BOND_CACHE_TTL_MS = 60_000;
type SlashBondStatusCacheEntry =
  | { value: SlashBondStatus; fetchedAt: number }
  | { error: unknown; fetchedAt: number };
const slashBondStatusCache = new Map<string, SlashBondStatusCacheEntry>();

function hasStringBalances(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.bondBalance === "string" &&
    typeof record.totalSlashed === "string"
  );
}

function isDemoSlashBondEvidence(
  value: unknown,
): value is DemoSlashBondEvidence {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.createdAt === "string" &&
    typeof record.role === "string" &&
    typeof record.caller === "string" &&
    typeof record.address === "string" &&
    typeof record.deployTx === "string" &&
    (record.approveTx === null || typeof record.approveTx === "string") &&
    typeof record.bondTx === "string" &&
    typeof record.slashTx === "string" &&
    typeof record.reasonHash === "string" &&
    typeof record.botId === "string" &&
    typeof record.bondAmountAtomicUsdc === "string" &&
    typeof record.slashAmountAtomicUsdc === "string" &&
    hasStringBalances(record.statusBeforeSlash) &&
    hasStringBalances(record.statusAfterSlash)
  );
}

export function createSlashBondPublicClient() {
  return createPublicClient({
    chain: arcChain,
    transport: http(ARC_RPC_URL),
  });
}

export function canSlashBond(
  status: SlashBondStatus,
  caller: Address,
): boolean {
  return status.attestor.toLowerCase() === caller.toLowerCase();
}

export async function readDemoSlashBondEvidence(): Promise<DemoSlashBondEvidence | null> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), "data", "slashbond-demo.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as unknown;
    return isDemoSlashBondEvidence(parsed) ? parsed : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw error;
  }
}

export async function readSlashBondStatus(
  address: Address = SLASH_BOND_ADDRESS,
  publicClient: PublicClient = createSlashBondPublicClient(),
): Promise<SlashBondStatus> {
  const [
    operator,
    attestor,
    recipient,
    botId,
    unbondDelay,
    bondBalance,
    totalSlashed,
    unbondAmount,
    unbondRequestedAt,
  ] = await Promise.all([
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "operator",
    }),
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "attestor",
    }),
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "recipient",
    }),
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "botId",
    }),
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "unbondDelay",
    }),
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
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "unbondAmount",
    }),
    publicClient.readContract({
      address,
      abi: slashBondAbi,
      functionName: "unbondRequestedAt",
    }),
  ]);

  return {
    address,
    operator,
    attestor,
    recipient,
    botId,
    unbondDelay,
    bondBalance,
    totalSlashed,
    unbondAmount,
    unbondRequestedAt,
  };
}

export async function readCachedSlashBondStatus(
  address: Address = SLASH_BOND_ADDRESS,
  publicClient?: PublicClient,
): Promise<SlashBondStatus> {
  if (publicClient) return readSlashBondStatus(address, publicClient);
  const key = address.toLowerCase();
  const cached = slashBondStatusCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < SLASH_BOND_CACHE_TTL_MS) {
    if ("value" in cached) return cached.value;
    throw cached.error;
  }
  try {
    const value = await readSlashBondStatus(address);
    slashBondStatusCache.set(key, { value, fetchedAt: now });
    return value;
  } catch (error) {
    slashBondStatusCache.set(key, { error, fetchedAt: now });
    throw error;
  }
}
