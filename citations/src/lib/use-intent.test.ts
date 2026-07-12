import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  recoverTypedDataAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQueryRecord } from "./engine";
import {
  resetFeeRouterNonceStateForTests,
  withReservedNonce,
} from "./fee-router-nonce";
import {
  anchorUseIntent,
  assertSpendWithinIntent,
  assertUseIntentNotExpired,
  buildUseIntent,
  signUseIntent,
  useIntentDigest,
  useIntentDomain,
  useIntentRecord,
  useIntentTypes,
  type BuiltUseIntent,
  type TollgateUseIntent,
} from "./use-intent";

const clients = vi.hoisted(() => ({
  getTransactionCount: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  writeContract: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      getTransactionCount: clients.getTransactionCount,
      waitForTransactionReceipt: clients.waitForTransactionReceipt,
    }),
    createWalletClient: () => ({ writeContract: clients.writeContract }),
  };
});

const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const PRIVATE_KEY = generatePrivateKey();
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const ANCHOR_TX = `0x${"c".repeat(64)}` as Hex;
let previousPrivateKey: string | undefined;
let previousAgentWallet: string | undefined;

function intent(): TollgateUseIntent {
  return {
    queryHash: `0x${"1".repeat(64)}` as Hex,
    candidateSetRoot: `0x${"2".repeat(64)}` as Hex,
    selectedSourcesRoot: `0x${"3".repeat(64)}` as Hex,
    decisionTraceHash: `0x${"4".repeat(64)}` as Hex,
    claimSupportRoot: `0x${"5".repeat(64)}` as Hex,
    maxSpendAtomicUsdc: 1_000n,
    expiry: 1_900_000_000n,
    nonce: 7n,
  };
}

function builtUseIntent(): BuiltUseIntent {
  return {
    intent: intent(),
    digest: `0x${"a".repeat(64)}` as Hex,
    plannedSpendAtomicUsdc: 100,
    registryAddress: REGISTRY,
    chainId: 5_042_002,
  };
}

beforeEach(() => {
  previousPrivateKey = process.env.LEPTONWEB_USE_INTENT_PRIVATE_KEY;
  previousAgentWallet = process.env.LEPTONWEB_AGENT_WALLET;
  process.env.LEPTONWEB_USE_INTENT_PRIVATE_KEY = PRIVATE_KEY;
  process.env.LEPTONWEB_AGENT_WALLET = ACCOUNT.address;
  resetFeeRouterNonceStateForTests();
  vi.resetAllMocks();
  clients.getTransactionCount.mockResolvedValue(41);
  clients.waitForTransactionReceipt.mockResolvedValue({
    status: "success",
    transactionHash: ANCHOR_TX,
  });
  clients.writeContract.mockResolvedValue(ANCHOR_TX);
});

afterEach(() => {
  if (previousPrivateKey === undefined) {
    delete process.env.LEPTONWEB_USE_INTENT_PRIVATE_KEY;
  } else {
    process.env.LEPTONWEB_USE_INTENT_PRIVATE_KEY = previousPrivateKey;
  }
  if (previousAgentWallet === undefined) {
    delete process.env.LEPTONWEB_AGENT_WALLET;
  } else {
    process.env.LEPTONWEB_AGENT_WALLET = previousAgentWallet;
  }
});

describe("TollgateUseIntent", () => {
  it("produces a deterministic EIP-712 digest", () => {
    const first = useIntentDigest(intent(), 5_042_002, REGISTRY);
    const second = useIntentDigest(intent(), 5_042_002, REGISTRY);

    expect(first).toBe(second);
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("round-trips a signature to the agent wallet", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signed = await signUseIntent(intent(), {
      account,
      chainId: 5_042_002,
      registryAddress: REGISTRY,
    });
    const recovered = await recoverTypedDataAddress({
      domain: useIntentDomain(5_042_002, REGISTRY),
      types: useIntentTypes,
      primaryType: "TollgateUseIntent",
      message: intent(),
      signature: signed,
    });

    expect(recovered).toBe(account.address);
  });

  it("builds roots from the query and rejects a cap below planned spend", () => {
    const query = createQueryRecord(
      "How do source-backed agent payments work?",
      "2026-07-11T00:00:00.000Z",
    );
    const planned = query.citations.reduce(
      (sum, citation) => sum + citation.amountAtomicUsdc,
      0,
    );
    const built = buildUseIntent(query, {
      chainId: 5_042_002,
      registryAddress: REGISTRY,
      maxSpendAtomicUsdc: planned,
      expiry: 1_900_000_000n,
      nonce: 11n,
    });

    expect(built.plannedSpendAtomicUsdc).toBe(planned);
    expect(built.intent.candidateSetRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(built.intent.selectedSourcesRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() =>
      buildUseIntent(query, {
        registryAddress: REGISTRY,
        maxSpendAtomicUsdc: planned - 1,
        expiry: 1_900_000_000n,
        nonce: 12n,
      }),
    ).toThrow("exceeds max");
  });

  it("rejects an expired intent and spend overrun", () => {
    const expired = intent();
    expect(() => assertUseIntentNotExpired(expired, 1_900_000_001)).toThrow(
      "expiry is in the past",
    );
    expect(() => assertSpendWithinIntent(expired, 1_001)).toThrow(
      "exceeds max",
    );
  });

  it("serializes the signed fields for the public ledger", () => {
    const built = builtUseIntent();
    const record = useIntentRecord(
      built,
      `0x${"b".repeat(130)}` as Hex,
      `0x${"c".repeat(64)}` as Hex,
    );

    expect(record).toMatchObject({
      digest: built.digest,
      chainId: 5_042_002,
      registryAddress: REGISTRY,
      nonce: "7",
      maxSpendAtomicUsdc: "1000",
      anchorTx: `0x${"c".repeat(64)}`,
    });
  });

  it("submits an anchor with a reserved pending nonce", async () => {
    const transaction = await anchorUseIntent(
      builtUseIntent(),
      `0x${"b".repeat(130)}` as Hex,
    );

    expect(transaction).toBe(ANCHOR_TX);
    expect(clients.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: 41 }),
    );
    expect(clients.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash: ANCHOR_TX,
    });
  });

  it("rejects a reverted anchor receipt", async () => {
    clients.waitForTransactionReceipt.mockResolvedValue({
      status: "reverted",
      transactionHash: ANCHOR_TX,
    });

    await expect(
      anchorUseIntent(
        builtUseIntent(),
        `0x${"b".repeat(130)}` as Hex,
      ),
    ).rejects.toThrow("Use-intent anchor failed with status reverted");
  });

  it("rejects a successful replacement transaction", async () => {
    clients.waitForTransactionReceipt.mockResolvedValue({
      status: "success",
      transactionHash: `0x${"d".repeat(64)}`,
    });

    await expect(
      anchorUseIntent(
        builtUseIntent(),
        `0x${"b".repeat(130)}` as Hex,
      ),
    ).rejects.toThrow("Use-intent anchor transaction was replaced");
  });

  it("shares nonce reservations with other submissions from the signer", async () => {
    const publicClient = {
      getTransactionCount: clients.getTransactionCount,
    } as unknown as PublicClient;
    const [transaction, otherNonce] = await Promise.all([
      anchorUseIntent(
        builtUseIntent(),
        `0x${"b".repeat(130)}` as Hex,
      ),
      withReservedNonce(publicClient, ACCOUNT, async (nonce) => nonce),
    ]);
    const anchorNonce = clients.writeContract.mock.calls[0]?.[0]?.nonce;
    if (typeof anchorNonce !== "number") {
      throw new Error("anchor submission did not include a nonce");
    }

    expect(transaction).toBe(ANCHOR_TX);
    expect([anchorNonce, otherNonce].sort((left, right) => left - right)).toEqual(
      [41, 42],
    );
    expect(clients.getTransactionCount).toHaveBeenCalledTimes(1);
  });
});
