import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it } from "vitest";
import { FEE_ROUTER_ADDRESS } from "./fee-router-contract.js";
import { resetFeeRouterNonceStateForTests } from "./fee-router-nonce.js";
import {
  assertValidFeeRouterSplit,
  createFeeRouterPublicClient,
  createFeeRouterSigner,
  createSplit,
  feeRouterEventsAbi,
  payViaSplit,
  readFeeRouterSplit,
  type FeeRouterWalletClient,
  type FeeRouterWriteContractRequest,
} from "./fee-router.js";
import {
  ensureCreatorSplit,
  type FeeRouterSplitRegistry,
  type SplitRegistryStore,
} from "./split-registry.js";

const TEST_KEY = generatePrivateKey();
const ACCOUNT = privateKeyToAccount(TEST_KEY).address;
const RECIPIENT = "0x7777777777777777777777777777777777777777" as Address;
const APPROVE_TX = `0x${"a".repeat(64)}` as Hex;
const CREATE_TX = `0x${"b".repeat(64)}` as Hex;
const PAY_TX = `0x${"c".repeat(64)}` as Hex;

type MockOptions = {
  allowance?: bigint;
  balance?: bigint;
  createStatus?: "success" | "reverted";
  minedSplitId?: bigint;
  payStatus?: "success" | "reverted";
  simulatedSplitId?: bigint;
};

function splitCreatedLog(splitId: bigint) {
  return {
    address: FEE_ROUTER_ADDRESS,
    blockHash: `0x${"d".repeat(64)}` as Hex,
    blockNumber: 1n,
    data: encodeAbiParameters(
      [
        { name: "recipients", type: "address[]" },
        { name: "bps", type: "uint16[]" },
      ],
      [[RECIPIENT], [10_000]],
    ),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({
      abi: feeRouterEventsAbi,
      eventName: "SplitCreated",
      args: { splitId, creator: ACCOUNT },
    }),
    transactionHash: CREATE_TX,
    transactionIndex: 0,
  };
}

function routedLog(splitId: bigint, amount: bigint) {
  return {
    address: FEE_ROUTER_ADDRESS,
    blockHash: `0x${"e".repeat(64)}` as Hex,
    blockNumber: 2n,
    data: encodeAbiParameters([{ name: "amount", type: "uint256" }], [amount]),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({
      abi: feeRouterEventsAbi,
      eventName: "Routed",
      args: { splitId, payer: ACCOUNT },
    }),
    transactionHash: PAY_TX,
    transactionIndex: 0,
  };
}

function mockClients(options: MockOptions = {}) {
  const allowance = options.allowance ?? 0n;
  const balance = options.balance ?? 20_000_000_000n;
  const createStatus = options.createStatus ?? "success";
  const minedSplitId = options.minedSplitId ?? 42n;
  const payStatus = options.payStatus ?? "success";
  const simulatedSplitId = options.simulatedSplitId ?? 41n;
  const writes: FeeRouterWriteContractRequest[] = [];
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return balance;
      if (functionName === "allowance") return allowance;
      if (functionName === "splitAt") {
        return {
          creator: ACCOUNT,
          recipients: [RECIPIENT],
          bps: [10_000],
          totalRouted: 0n,
          createdAt: 1n,
        };
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async (request: FeeRouterWriteContractRequest) => ({
      result: simulatedSplitId,
      request,
    }),
    getTransactionCount: async () => 50,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      if (hash === APPROVE_TX) return { status: "success", logs: [] };
      if (hash === CREATE_TX) {
        return {
          status: createStatus,
          logs:
            createStatus === "success" ? [splitCreatedLog(minedSplitId)] : [],
        };
      }
      if (hash === PAY_TX) {
        return {
          status: payStatus,
          logs:
            payStatus === "success" ? [routedLog(minedSplitId, 1_000n)] : [],
        };
      }
      throw new Error(`unexpected receipt ${hash}`);
    },
  } as unknown as PublicClient;
  const walletClient: FeeRouterWalletClient = {
    writeContract: async (request) => {
      writes.push(request);
      if (request.functionName === "approve") return APPROVE_TX;
      if (request.functionName === "createSplit") return CREATE_TX;
      if (request.functionName === "pay") return PAY_TX;
      throw new Error(`unexpected write ${request.functionName}`);
    },
  };
  return {
    publicClient,
    signer: createFeeRouterSigner(TEST_KEY, { walletClient }),
    writes,
  };
}

beforeEach(() => {
  resetFeeRouterNonceStateForTests();
});

describe("FeeRouter split validation", () => {
  it("uses Arc-speed polling for the default public client", () => {
    const client = createFeeRouterPublicClient() as PublicClient & {
      pollingInterval: number;
    };

    expect(client.pollingInterval).toBe(250);
  });

  it("accepts a complete basis-point split", () => {
    expect(() =>
      assertValidFeeRouterSplit([RECIPIENT], [10_000]),
    ).not.toThrow();
  });

  it("rejects empty, mismatched, and incomplete splits", () => {
    expect(() => assertValidFeeRouterSplit([], [])).toThrow(
      "at least one recipient",
    );
    expect(() =>
      assertValidFeeRouterSplit([RECIPIENT], [5_000, 5_000]),
    ).toThrow("length mismatch");
    expect(() => assertValidFeeRouterSplit([RECIPIENT], [9_999])).toThrow(
      "sum to 10000",
    );
    expect(() =>
      assertValidFeeRouterSplit(
        [RECIPIENT, "0x8888888888888888888888888888888888888888"],
        [10_000.5, -0.5],
      ),
    ).toThrow("uint16 integers");
    expect(() =>
      assertValidFeeRouterSplit(
        ["0x0000000000000000000000000000000000000000"],
        [10_000],
      ),
    ).toThrow("non-zero EVM addresses");
  });
});

describe("createSplit", () => {
  it("uses the mined event split id and an explicit reserved nonce", async () => {
    const { publicClient, signer, writes } = mockClients({
      minedSplitId: 42n,
      simulatedSplitId: 41n,
    });

    const result = await createSplit(
      signer,
      [RECIPIENT],
      [10_000],
      publicClient,
    );

    expect(result).toEqual({ splitId: 42n, txHash: CREATE_TX });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.functionName).toBe("createSplit");
    expect(writes[0]?.nonce).toBe(50);
    expect(
      (writes[0]?.account as { address?: Address } | undefined)?.address,
    ).toBe(ACCOUNT);
  });

  it("rejects a reverted split transaction", async () => {
    const { publicClient, signer } = mockClients({ createStatus: "reverted" });

    await expect(
      createSplit(signer, [RECIPIENT], [10_000], publicClient),
    ).rejects.toThrow("reverted");
  });
});

describe("payViaSplit", () => {
  it("approves a standing allowance before routing a payment", async () => {
    const { publicClient, signer, writes } = mockClients();

    const result = await payViaSplit(signer, 42n, 1_000n, publicClient);

    expect(result).toEqual({ txHash: PAY_TX });
    expect(writes.map((write) => write.functionName)).toEqual([
      "approve",
      "pay",
    ]);
    expect(writes[0]?.args).toEqual([FEE_ROUTER_ADDRESS, 10_000_000_000n]);
    expect(writes.map((write) => write.nonce)).toEqual([50, 51]);
  });

  it("approves the payment amount when it exceeds the standing allowance", async () => {
    const amount = 10_000_000_001n;
    const { publicClient, signer, writes } = mockClients({
      balance: amount,
      minedSplitId: 42n,
    });
    const client = {
      ...publicClient,
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        if (hash === APPROVE_TX) return { status: "success", logs: [] };
        return {
          status: "success",
          logs: [routedLog(42n, amount)],
        };
      },
    } as unknown as PublicClient;

    await payViaSplit(signer, 42n, amount, client);

    expect(writes[0]?.args).toEqual([FEE_ROUTER_ADDRESS, amount]);
  });

  it("skips approval when the existing allowance covers the payment", async () => {
    const { publicClient, signer, writes } = mockClients({ allowance: 1_000n });

    await payViaSplit(signer, 42n, 1_000n, publicClient);

    expect(writes.map((write) => write.functionName)).toEqual(["pay"]);
  });

  it("serializes same-payer preflight so concurrent calls cannot overspend", async () => {
    let balance = 1_500n;
    const writes: FeeRouterWriteContractRequest[] = [];
    const publicClient = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "balanceOf") return balance;
        if (functionName === "allowance") return 10_000_000_000n;
        throw new Error(`unexpected read ${functionName}`);
      },
      getTransactionCount: async () => 80,
      waitForTransactionReceipt: async () => {
        balance -= 1_000n;
        return { status: "success", logs: [routedLog(42n, 1_000n)] };
      },
    } as unknown as PublicClient;
    const walletClient: FeeRouterWalletClient = {
      writeContract: async (request) => {
        writes.push(request);
        return PAY_TX;
      },
    };
    const signer = createFeeRouterSigner(TEST_KEY, { walletClient });

    const first = payViaSplit(signer, 42n, 1_000n, publicClient);
    const second = payViaSplit(signer, 42n, 1_000n, publicClient);

    await expect(first).resolves.toEqual({ txHash: PAY_TX });
    await expect(second).rejects.toThrow("insufficient USDC");
    expect(writes).toHaveLength(1);
    expect(balance).toBe(500n);
  });

  it("rejects non-positive and underfunded payments before writing", async () => {
    const { publicClient, signer, writes } = mockClients({ balance: 999n });

    await expect(payViaSplit(signer, 42n, 0n, publicClient)).rejects.toThrow(
      "must be positive",
    );
    await expect(
      payViaSplit(signer, 42n, 1_000n, publicClient),
    ).rejects.toThrow("insufficient USDC");
    expect(writes).toHaveLength(0);
  });

  it("rejects split ids outside uint256 before reading or writing", async () => {
    const { publicClient, signer, writes } = mockClients();

    await expect(readFeeRouterSplit(-1n, publicClient)).rejects.toThrow(
      "splitId must be a uint256",
    );
    await expect(
      payViaSplit(signer, 1n << 256n, 1_000n, publicClient),
    ).rejects.toThrow("splitId must be a uint256");
    expect(writes).toHaveLength(0);
  });

  it("rejects a reverted payment receipt", async () => {
    const { publicClient, signer } = mockClients({
      allowance: 1_000n,
      payStatus: "reverted",
    });

    await expect(
      payViaSplit(signer, 42n, 1_000n, publicClient),
    ).rejects.toThrow("reverted");
  });
});

describe("ensureCreatorSplit", () => {
  it("serializes concurrent creation and reuses the stored split", async () => {
    let registry: FeeRouterSplitRegistry = { splits: [] };
    const store: SplitRegistryStore = {
      read: async () => registry,
      write: async (next) => {
        registry = next;
      },
    };
    const { publicClient, signer, writes } = mockClients({ minedSplitId: 42n });

    const [first, second] = await Promise.all([
      ensureCreatorSplit(
        store,
        "toy-paywall",
        RECIPIENT,
        [RECIPIENT],
        [10_000],
        signer,
        publicClient,
      ),
      ensureCreatorSplit(
        store,
        "toy-paywall",
        RECIPIENT,
        [RECIPIENT],
        [10_000],
        signer,
        publicClient,
      ),
    ]);

    expect(first.splitId).toBe("42");
    expect(second).toEqual(first);
    expect(registry.splits).toHaveLength(1);
    expect(writes.map((write) => write.functionName)).toEqual(["createSplit"]);
  });

  it("uses the store atomic operation when it is available", async () => {
    let insertCalls = 0;
    let createCalls = 0;
    const store: SplitRegistryStore = {
      read: async () => {
        throw new Error("atomic store must not fall back to read");
      },
      write: async () => {
        throw new Error("atomic store must not fall back to write");
      },
      getOrInsert: async (_key, insert) => {
        insertCalls += 1;
        return { record: await insert(), inserted: true };
      },
    };
    const { publicClient, signer, writes } = mockClients();

    const record = await ensureCreatorSplit(
      store,
      "toy-paywall",
      RECIPIENT,
      [RECIPIENT],
      [10_000],
      signer,
      publicClient,
      async () => {
        createCalls += 1;
        return { splitId: 42n, txHash: CREATE_TX };
      },
    );

    expect(record.splitId).toBe("42");
    expect(insertCalls).toBe(1);
    expect(createCalls).toBe(1);
    expect(writes).toEqual([]);
  });

  it("requires an explicit tenant id", async () => {
    const store: SplitRegistryStore = {
      read: async () => ({ splits: [] }),
      write: async () => undefined,
    };
    const { publicClient, signer } = mockClients();

    await expect(
      ensureCreatorSplit(
        store,
        " ",
        RECIPIENT,
        [RECIPIENT],
        [10_000],
        signer,
        publicClient,
      ),
    ).rejects.toThrow("tenantId is required");
  });

  it("rejects tenant ids that exceed the registry limit", async () => {
    const store: SplitRegistryStore = {
      read: async () => ({ splits: [] }),
      write: async () => undefined,
    };
    const { publicClient, signer } = mockClients();

    await expect(
      ensureCreatorSplit(
        store,
        "t".repeat(121),
        RECIPIENT,
        [RECIPIENT],
        [10_000],
        signer,
        publicClient,
      ),
    ).rejects.toThrow("120 characters or fewer");
  });

  it("rejects an invalid registry wallet before creating a split", async () => {
    const store: SplitRegistryStore = {
      read: async () => ({ splits: [] }),
      write: async () => undefined,
    };
    const { publicClient, signer, writes } = mockClients();

    await expect(
      ensureCreatorSplit(
        store,
        "toy-paywall",
        "0x0000000000000000000000000000000000000000",
        [RECIPIENT],
        [10_000],
        signer,
        publicClient,
      ),
    ).rejects.toThrow("wallet must be a non-zero EVM address");
    expect(writes).toHaveLength(0);
  });
});
