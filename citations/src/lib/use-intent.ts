import {
  createPublicClient,
  createWalletClient,
  hashTypedData,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type LocalAccount } from "viem/accounts";
import { ARC_CHAIN_ID, ARC_RPC_URL, arcTestnet } from "./chain";
import { sha256Hex } from "./hash";
import { tollgateAgentWallet } from "./payments";
import type { QueryRecord, UseIntentRecord } from "./types";

const DEFAULT_INTENT_TTL_SECONDS = 900;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export const USE_INTENT_DOMAIN_NAME = "Tollgate UseReceipt Registry";
export const USE_INTENT_DOMAIN_VERSION = "1";

export const useIntentTypes = {
  TollgateUseIntent: [
    { name: "queryHash", type: "bytes32" },
    { name: "candidateSetRoot", type: "bytes32" },
    { name: "selectedSourcesRoot", type: "bytes32" },
    { name: "decisionTraceHash", type: "bytes32" },
    { name: "claimSupportRoot", type: "bytes32" },
    { name: "maxSpendAtomicUsdc", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

export const useReceiptRegistryAbi = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "queryHash", type: "bytes32" },
          { name: "candidateSetRoot", type: "bytes32" },
          { name: "selectedSourcesRoot", type: "bytes32" },
          { name: "decisionTraceHash", type: "bytes32" },
          { name: "claimSupportRoot", type: "bytes32" },
          { name: "maxSpendAtomicUsdc", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
  {
    type: "function",
    name: "hashIntent",
    stateMutability: "view",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: [
          { name: "queryHash", type: "bytes32" },
          { name: "candidateSetRoot", type: "bytes32" },
          { name: "selectedSourcesRoot", type: "bytes32" },
          { name: "decisionTraceHash", type: "bytes32" },
          { name: "claimSupportRoot", type: "bytes32" },
          { name: "maxSpendAtomicUsdc", type: "uint256" },
          { name: "expiry", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
  {
    type: "function",
    name: "usedNonces",
    stateMutability: "view",
    inputs: [{ name: "nonce", type: "uint256" }],
    outputs: [{ name: "used", type: "bool" }],
  },
  {
    type: "function",
    name: "tollgateAgentWallet",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export type TollgateUseIntent = {
  queryHash: Hex;
  candidateSetRoot: Hex;
  selectedSourcesRoot: Hex;
  decisionTraceHash: Hex;
  claimSupportRoot: Hex;
  maxSpendAtomicUsdc: bigint;
  expiry: bigint;
  nonce: bigint;
};

export type UseIntentSigner = LocalAccount;

export type BuiltUseIntent = {
  intent: TollgateUseIntent;
  digest: Hex;
  plannedSpendAtomicUsdc: number;
  registryAddress: Address;
  chainId: number;
};

export type BuildUseIntentOptions = {
  chainId?: number;
  registryAddress?: Address;
  maxSpendAtomicUsdc?: number;
  expiry?: bigint;
  nonce?: bigint;
};

function bytes32(value: string, label: string): Hex {
  if (!BYTES32_PATTERN.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }
  return value as Hex;
}

function address(value: string, label: string): Address {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error(`${label} must be a 20-byte EVM address.`);
  }
  return value as Address;
}

export function useIntentEnabled(): boolean {
  return process.env.LEPTONWEB_USE_INTENT_ENABLED === "1";
}

export function useReceiptRegistryAddress(): Address {
  const configured = process.env.LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS;
  if (!configured) {
    throw new Error(
      "LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS is required when use-intent anchoring is enabled.",
    );
  }
  return address(configured, "LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS");
}

export function useIntentDomain(
  chainId: number,
  registryAddress: Address,
) {
  return {
    name: USE_INTENT_DOMAIN_NAME,
    version: USE_INTENT_DOMAIN_VERSION,
    chainId,
    verifyingContract: registryAddress,
  } as const;
}

function intentMessage(intent: TollgateUseIntent) {
  return {
    queryHash: intent.queryHash,
    candidateSetRoot: intent.candidateSetRoot,
    selectedSourcesRoot: intent.selectedSourcesRoot,
    decisionTraceHash: intent.decisionTraceHash,
    claimSupportRoot: intent.claimSupportRoot,
    maxSpendAtomicUsdc: intent.maxSpendAtomicUsdc,
    expiry: intent.expiry,
    nonce: intent.nonce,
  };
}

export function useIntentDigest(
  intent: TollgateUseIntent,
  chainId: number,
  registryAddress: Address,
): Hex {
  return hashTypedData({
    domain: useIntentDomain(chainId, registryAddress),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: intentMessage(intent),
  });
}

function configuredInteger(name: string): number | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer.`);
  }
  return parsed;
}

function configuredBigInt(name: string): bigint | null {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return null;
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("negative");
    return parsed;
  } catch {
    throw new Error(`${name} must be a non-negative integer.`);
  }
}

export function querySpendAtomicUsdc(query: QueryRecord): number {
  return query.citations.reduce((sum, citation) => {
    if (citation.payoutPolicy === "refund-unused") return sum;
    return sum + (citation.payoutAtomicUsdc ?? citation.amountAtomicUsdc);
  }, 0);
}

function nextIntentNonce(query: QueryRecord): bigint {
  const configured = configuredBigInt("LEPTONWEB_USE_INTENT_NONCE");
  if (configured !== null) return configured;
  return BigInt(
    `0x${sha256Hex({ queryId: query.id, createdAt: query.createdAt }).slice(2, 34)}`,
  );
}

function intentTtlSeconds(): bigint {
  const configured = configuredInteger("LEPTONWEB_USE_INTENT_TTL_SECONDS");
  return BigInt(configured ?? DEFAULT_INTENT_TTL_SECONDS);
}

export function assertSpendWithinIntent(
  intent: TollgateUseIntent,
  spendAtomicUsdc: number,
): void {
  if (!Number.isSafeInteger(spendAtomicUsdc) || spendAtomicUsdc < 0) {
    throw new Error("Use-intent spend must be a non-negative safe integer.");
  }
  if (BigInt(spendAtomicUsdc) > intent.maxSpendAtomicUsdc) {
    throw new Error(
      `Use-intent spend ${spendAtomicUsdc} exceeds max ${intent.maxSpendAtomicUsdc.toString()} atomic USDC.`,
    );
  }
}

export function assertUseIntentNotExpired(
  intent: TollgateUseIntent,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (intent.expiry < BigInt(nowSeconds)) {
    throw new Error("Use-intent expiry is in the past.");
  }
}

export function buildUseIntent(
  query: QueryRecord,
  options: BuildUseIntentOptions = {},
): BuiltUseIntent {
  const registryAddress =
    options.registryAddress ?? useReceiptRegistryAddress();
  const chainId = options.chainId ?? ARC_CHAIN_ID;
  const plannedSpendAtomicUsdc = querySpendAtomicUsdc(query);
  const configuredMax = configuredInteger(
    "LEPTONWEB_USE_INTENT_MAX_SPEND_ATOMIC_USDC",
  );
  const maxSpendAtomicUsdc =
    options.maxSpendAtomicUsdc ?? configuredMax ?? plannedSpendAtomicUsdc;
  if (!Number.isSafeInteger(maxSpendAtomicUsdc) || maxSpendAtomicUsdc < 0) {
    throw new Error(
      "Use-intent max spend must be a non-negative safe integer.",
    );
  }
  const expiry =
    options.expiry ??
    BigInt(Math.floor(Date.now() / 1000)) + intentTtlSeconds();
  const nonce = options.nonce ?? nextIntentNonce(query);
  const intent: TollgateUseIntent = {
    queryHash: bytes32(query.queryHash, "queryHash"),
    candidateSetRoot: bytes32(
      sha256Hex(query.sourceDecisions ?? []),
      "candidateSetRoot",
    ),
    selectedSourcesRoot: bytes32(
      sha256Hex(query.citations.map((citation) => citation.sourceId)),
      "selectedSourcesRoot",
    ),
    decisionTraceHash: bytes32(
      query.traceHash ?? sha256Hex(query.agentSteps ?? []),
      "decisionTraceHash",
    ),
    claimSupportRoot: bytes32(
      query.claimSupportRoot ?? sha256Hex(query.claimSupport ?? []),
      "claimSupportRoot",
    ),
    maxSpendAtomicUsdc: BigInt(maxSpendAtomicUsdc),
    expiry,
    nonce,
  };
  assertUseIntentNotExpired(intent);
  assertSpendWithinIntent(intent, plannedSpendAtomicUsdc);
  return {
    intent,
    digest: useIntentDigest(intent, chainId, registryAddress),
    plannedSpendAtomicUsdc,
    registryAddress,
    chainId,
  };
}

function useIntentPrivateKey(): Hex {
  const value =
    process.env.LEPTONWEB_USE_INTENT_PRIVATE_KEY ??
    process.env.LEPTONWEB_FEE_ROUTER_PRIVATE_KEY;
  if (!value) {
    throw new Error(
      "LEPTONWEB_USE_INTENT_PRIVATE_KEY or a matching LEPTONWEB_FEE_ROUTER_PRIVATE_KEY is required when use-intent anchoring is enabled.",
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("LEPTONWEB_USE_INTENT_PRIVATE_KEY must be a 32-byte hex key.");
  }
  return value as Hex;
}

export function createUseIntentSigner(): UseIntentSigner {
  const account = privateKeyToAccount(useIntentPrivateKey());
  const configuredAgent = tollgateAgentWallet();
  if (account.address.toLowerCase() !== configuredAgent.toLowerCase()) {
    throw new Error(
      `Use-intent signer ${account.address} does not match agent wallet ${configuredAgent}.`,
    );
  }
  return account;
}

export async function signUseIntent(
  intent: TollgateUseIntent,
  options: {
    account?: UseIntentSigner;
    chainId?: number;
    registryAddress?: Address;
  } = {},
): Promise<Hex> {
  const account = options.account ?? createUseIntentSigner();
  return account.signTypedData({
    domain: useIntentDomain(
      options.chainId ?? ARC_CHAIN_ID,
      options.registryAddress ?? useReceiptRegistryAddress(),
    ),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: intentMessage(intent),
  });
}

function contractIntent(intent: TollgateUseIntent) {
  return {
    queryHash: intent.queryHash,
    candidateSetRoot: intent.candidateSetRoot,
    selectedSourcesRoot: intent.selectedSourcesRoot,
    decisionTraceHash: intent.decisionTraceHash,
    claimSupportRoot: intent.claimSupportRoot,
    maxSpendAtomicUsdc: intent.maxSpendAtomicUsdc,
    expiry: intent.expiry,
    nonce: intent.nonce,
  };
}

export async function anchorUseIntent(
  built: BuiltUseIntent,
  signature: Hex,
): Promise<Hex> {
  const account = createUseIntentSigner();
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
  const transaction = await walletClient.writeContract({
    address: built.registryAddress,
    abi: useReceiptRegistryAbi,
    functionName: "anchor",
    args: [contractIntent(built.intent), signature],
    account,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash: transaction });
  return transaction;
}

export function useIntentRecord(
  built: BuiltUseIntent,
  signature: Hex,
  anchorTx: Hex,
): UseIntentRecord {
  return {
    digest: built.digest,
    signature,
    chainId: built.chainId,
    registryAddress: built.registryAddress,
    nonce: built.intent.nonce.toString(),
    anchorTx,
    maxSpendAtomicUsdc: built.intent.maxSpendAtomicUsdc.toString(),
    expiry: built.intent.expiry.toString(),
    candidateSetRoot: built.intent.candidateSetRoot,
    selectedSourcesRoot: built.intent.selectedSourcesRoot,
    decisionTraceHash: built.intent.decisionTraceHash,
    claimSupportRoot: built.intent.claimSupportRoot,
  };
}
