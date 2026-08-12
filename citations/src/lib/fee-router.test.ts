import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { DEFAULT_CREATOR_SOURCES } from "./catalog";
import { createQueryRecord } from "./engine";
import {
  assertValidFeeRouterSplit,
  createFeeRouterPublicClient,
  readFeeRouterSplitRegistry,
  refundReaderPayment,
  routeCitationPayments,
  routeEscrowReleasePayment,
  type FeeRouterWalletClient,
} from "./fee-router";
import { resetFeeRouterNonceStateForTests } from "./fee-router-nonce";

const TEST_KEY = generatePrivateKey();
const FEE_ROUTER = "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59";
const SPLIT_CREATED_EVENT_ABI = [
  {
    type: "event",
    name: "SplitCreated",
    inputs: [
      { name: "splitId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "recipients", type: "address[]", indexed: false },
      { name: "bps", type: "uint16[]", indexed: false },
    ],
  },
] as const;

beforeEach(() => {
  resetFeeRouterNonceStateForTests();
});

type ContractCall = {
  functionName: string;
  args?: readonly unknown[];
  account?: unknown;
  nonce?: number;
};

function accountAddress(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("address" in value)) {
    return null;
  }
  const address = (value as { address?: unknown }).address;
  return typeof address === "string" ? address : null;
}

function splitCreatedLog(
  splitId: bigint,
  creator: Address,
  recipients: Address[],
  bps: number[],
) {
  return {
    address: FEE_ROUTER,
    topics: encodeEventTopics({
      abi: SPLIT_CREATED_EVENT_ABI,
      eventName: "SplitCreated",
      args: { splitId, creator },
    }),
    data: encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint16[]" }],
      [recipients, bps],
    ),
  };
}

function oneCitationQuery() {
  const query = createQueryRecord(
    "How should Forum route paid citation receipts?",
    "2026-06-23T00:00:00.000Z",
  );
  const citation = query.citations[0];
  if (!citation) throw new Error("missing test citation");
  return {
    ...query,
    citations: [citation],
    totalAtomicUsdc: citation.amountAtomicUsdc,
  };
}

function mockClients(
  recipient: Address,
  allowance: bigint,
  createSplitId: bigint,
  writes: string[],
  paidSplitIds: bigint[] = [],
  createSplitAccounts: unknown[] = [],
  createSplitArgs: unknown[][] = [],
  paidAmounts: bigint[] = [],
) {
  let createdRecipients: Address[] = [recipient];
  let createdBps = [10_000];
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return 1_000_000n;
      if (functionName === "allowance") return allowance;
      if (functionName === "splitAt") {
        return {
          creator: recipient,
          recipients: [recipient],
          bps: [10_000],
          totalRouted: 0n,
          createdAt: 1n,
        };
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async (request: ContractCall) => {
      if (
        request.functionName === "createSplit" &&
        Array.isArray(request.args?.[0]) &&
        Array.isArray(request.args?.[1])
      ) {
        createdRecipients = request.args[0] as Address[];
        createdBps = request.args[1] as number[];
      }
      return {
        result: createSplitId,
        request: {
          ...request,
          account: "0x4164F5B52ecc6F847f03071A287b0B59954cbcEe",
        },
      };
    },
    getTransactionCount: async () => 50,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
      status: "success",
      transactionHash: hash,
      logs:
        hash === `0x${"b".repeat(64)}`
          ? [
              splitCreatedLog(
                createSplitId,
                privateKeyToAccount(TEST_KEY).address,
                createdRecipients,
                createdBps,
              ),
            ]
          : [],
    }),
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async ({ functionName, args, account }: ContractCall) => {
      writes.push(functionName);
      if (functionName === "createSplit") {
        createSplitAccounts.push(account);
        createSplitArgs.push([...(args ?? [])]);
      }
      if (functionName === "pay" && typeof args?.[0] === "bigint") {
        paidSplitIds.push(args[0]);
      }
      if (functionName === "pay" && typeof args?.[1] === "bigint") {
        paidAmounts.push(args[1]);
      }
      const txByte =
        functionName === "approve"
          ? "a"
          : functionName === "createSplit"
            ? "b"
            : "c";
      return `0x${txByte.repeat(64)}` as Hex;
    },
  } as FeeRouterWalletClient;
  return { publicClient, walletClient };
}

describe("assertValidFeeRouterSplit", () => {
  it("uses Arc-speed polling for the default FeeRouter public client", () => {
    const client = createFeeRouterPublicClient() as PublicClient & {
      pollingInterval: number;
    };

    expect(client.pollingInterval).toBe(250);
  });

  it("accepts a 10000 bps split", () => {
    expect(() =>
      assertValidFeeRouterSplit(
        ["0x7777777777777777777777777777777777777777"],
        [10_000],
      ),
    ).not.toThrow();
  });

  it("rejects mismatched recipients and bps", () => {
    expect(() =>
      assertValidFeeRouterSplit(
        ["0x7777777777777777777777777777777777777777"],
        [5_000, 5_000],
      ),
    ).toThrow("length mismatch");
  });

  it("rejects splits that do not sum to 10000 bps", () => {
    expect(() =>
      assertValidFeeRouterSplit(
        ["0x7777777777777777777777777777777777777777"],
        [9_999],
      ),
    ).toThrow("sum to 10000");
  });

  it("returns no receipt evidence when FeeRouter settlement is disabled", async () => {
    const query = createQueryRecord(
      "How should Forum route paid citation receipts?",
      "2026-06-23T00:00:00.000Z",
    );

    await expect(
      routeCitationPayments(query, { enabled: false }),
    ).resolves.toEqual({});
  });

  it("does not validate payout overrides while FeeRouter settlement is disabled", async () => {
    const query = oneCitationQuery();
    query.citations = query.citations.map((citation) => ({
      ...citation,
      payoutAtomicUsdc: -1,
    }));

    await expect(
      routeCitationPayments(query, { enabled: false }),
    ).resolves.toEqual({});
  });

  it("requires a runtime private key when FeeRouter settlement is enabled", async () => {
    const query = createQueryRecord(
      "How should Forum route paid citation receipts?",
      "2026-06-23T00:00:00.000Z",
    );

    await expect(
      routeCitationPayments(query, { enabled: true }),
    ).rejects.toThrow("LEPTONWEB_FEE_ROUTER_PRIVATE_KEY");
  });

  it("escrows unverified external citations by default before loading a FeeRouter key", async () => {
    const previous = process.env.TOLLGATE_ESCROW_UNVERIFIED;
    delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
    const query = oneCitationQuery();
    query.citations = query.citations.map((citation) => ({
      ...citation,
      sourceKind: "external",
      verifiedCreator: false,
    }));

    try {
      const evidence = await routeCitationPayments(query, { enabled: true });

      expect(evidence[query.citations[0].sourceId]).toEqual({
        settlementMode: "escrowed",
        paymentResource: "tollgate-escrow:unverified-source",
        payoutPolicy: "escrow-unverified",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
      } else {
        process.env.TOLLGATE_ESCROW_UNVERIFIED = previous;
      }
    }
  });

  it("escrows historical creator-claimed external citations", async () => {
    const previous = process.env.TOLLGATE_ESCROW_UNVERIFIED;
    delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
    const query = oneCitationQuery();
    query.citations = query.citations.map((citation) => ({
      ...citation,
      sourceKind: "external",
      verifiedCreator: false,
      creatorClaimed: true,
      ownershipProof: {
        method: "creator-claimed",
        verifiedAt: "2026-07-07T00:00:00.000Z",
      },
    }));

    try {
      const evidence = await routeCitationPayments(query, { enabled: false });

      expect(evidence[query.citations[0].sourceId]).toEqual({
        settlementMode: "escrowed",
        paymentResource: "tollgate-escrow:unverified-source",
        payoutPolicy: "escrow-unverified",
      });
    } finally {
      if (previous === undefined) {
        delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
      } else {
        process.env.TOLLGATE_ESCROW_UNVERIFIED = previous;
      }
    }
  });

  it("allows direct FeeRouter routing when unverified escrow is explicitly disabled", async () => {
    const previous = process.env.TOLLGATE_ESCROW_UNVERIFIED;
    process.env.TOLLGATE_ESCROW_UNVERIFIED = "0";
    const query = oneCitationQuery();
    query.citations = query.citations.map((citation) => ({
      ...citation,
      sourceKind: "external",
      verifiedCreator: false,
    }));

    try {
      await expect(
        routeCitationPayments(query, { enabled: true }),
      ).rejects.toThrow("LEPTONWEB_FEE_ROUTER_PRIVATE_KEY");
    } finally {
      if (previous === undefined) {
        delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
      } else {
        process.env.TOLLGATE_ESCROW_UNVERIFIED = previous;
      }
    }
  });

  it("records refunds without loading a FeeRouter key", async () => {
    const query = oneCitationQuery();
    query.citations = query.citations.map((citation) => ({
      ...citation,
      payoutPolicy: "refund-unused" as const,
    }));

    const evidence = await routeCitationPayments(query, { enabled: true });

    expect(evidence[query.citations[0].sourceId]).toEqual({
      settlementMode: "refunded",
      paymentResource: "tollgate-refund:unused-source",
      payoutPolicy: "refund-unused",
      refundReason: "Bought source was not cited in the final answer.",
    });
  });

  it("pays the split id returned by createSplit simulation", async () => {
    const query = oneCitationQuery();
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const createSplitAccounts: unknown[] = [];
    const { publicClient, walletClient } = mockClients(
      query.citations[0].wallet,
      0n,
      123n,
      writes,
      paidSplitIds,
      createSplitAccounts,
    );

    try {
      const evidence = await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["approve", "createSplit", "pay"]);
      expect(paidSplitIds).toEqual([123n]);
      expect(accountAddress(createSplitAccounts[0])).toBe(
        privateKeyToAccount(TEST_KEY).address,
      );
      expect(evidence[query.citations[0].sourceId]?.feeRouterSplitId).toBe(
        "123",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the split id from the mined SplitCreated event when the prediction races", async () => {
    const query = oneCitationQuery();
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const { publicClient, walletClient } = mockClients(
      query.citations[0].wallet,
      1_000_000n,
      123n,
      writes,
      paidSplitIds,
    );
    Object.assign(publicClient, {
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
        status: "success",
        transactionHash: hash,
        logs:
          hash === `0x${"b".repeat(64)}`
            ? [
                splitCreatedLog(
                  124n,
                  privateKeyToAccount(TEST_KEY).address,
                  [query.citations[0].wallet],
                  [10_000],
                ),
              ]
            : [],
      }),
    });

    try {
      const evidence = await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(paidSplitIds).toEqual([124n]);
      expect(evidence[query.citations[0].sourceId]?.feeRouterSplitId).toBe(
        "124",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a reverted FeeRouter payment receipt", async () => {
    const query = oneCitationQuery();
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(
      query.citations[0].wallet,
      1_000_000n,
      129n,
      writes,
    );
    const waitForReceipt =
      publicClient.waitForTransactionReceipt.bind(publicClient);
    Object.assign(publicClient, {
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) =>
        hash === `0x${"c".repeat(64)}`
          ? { status: "reverted", transactionHash: hash, logs: [] }
          : waitForReceipt({ hash }),
    });

    try {
      await expect(
        routeCitationPayments(query, {
          enabled: true,
          privateKey: TEST_KEY,
          publicClient,
          walletClient,
          splitRegistryPath: registryPath,
        }),
      ).rejects.toThrow(
        "FeeRouter pay transaction failed with status reverted",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a successful replacement of the FeeRouter payment", async () => {
    const query = oneCitationQuery();
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(
      query.citations[0].wallet,
      1_000_000n,
      130n,
      writes,
    );
    const waitForReceipt =
      publicClient.waitForTransactionReceipt.bind(publicClient);
    Object.assign(publicClient, {
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) =>
        hash === `0x${"c".repeat(64)}`
          ? {
              status: "success",
              transactionHash: `0x${"d".repeat(64)}`,
              logs: [],
            }
          : waitForReceipt({ hash }),
    });

    try {
      await expect(
        routeCitationPayments(query, {
          enabled: true,
          privateKey: TEST_KEY,
          publicClient,
          walletClient,
          splitRegistryPath: registryPath,
        }),
      ).rejects.toThrow("FeeRouter pay transaction was replaced");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("routes the contribution-weighted payout amount", async () => {
    const query = oneCitationQuery();
    query.citations = query.citations.map((citation) => ({
      ...citation,
      payoutAtomicUsdc: 123,
    }));
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const paidAmounts: bigint[] = [];
    const { publicClient, walletClient } = mockClients(
      query.citations[0].wallet,
      1_000_000n,
      128n,
      writes,
      paidSplitIds,
      [],
      [],
      paidAmounts,
    );

    try {
      await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(paidAmounts).toEqual([123n]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("settles citation payouts concurrently rather than one at a time", async () => {
    const base = oneCitationQuery();
    const first = base.citations[0];
    if (!first) throw new Error("missing test citation");
    // Same creator wallet on purpose. ensureCreatorSplit serialises split
    // creation behind a lock, so two different wallets would queue behind each
    // other and the only overlap left would be a race this test cannot rely on.
    // Sharing a wallet means one split is created and reused, leaving the two
    // pay transactions genuinely concurrent.
    const second = {
      ...first,
      sourceId: `${first.sourceId}-second`,
    };
    const query = {
      ...base,
      citations: [first, second],
      totalAtomicUsdc: first.amountAtomicUsdc + second.amountAtomicUsdc,
    };
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(
      first.wallet,
      0n,
      123n,
      writes,
    );

    // Sequential settlement can never have two receipts outstanding at once, so
    // the high-water mark is what distinguishes it from a concurrent one.
    let inFlight = 0;
    let maxInFlight = 0;
    const waitForReceipt =
      publicClient.waitForTransactionReceipt.bind(publicClient);
    publicClient.waitForTransactionReceipt = (async (
      args: Parameters<typeof waitForReceipt>[0],
    ) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return await waitForReceipt(args);
      } finally {
        inFlight -= 1;
      }
    }) as typeof publicClient.waitForTransactionReceipt;

    try {
      const evidence = await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(maxInFlight).toBeGreaterThan(1);
      expect(evidence[first.sourceId]?.settlementMode).toBe("forum-routed");
      expect(evidence[second.sourceId]?.settlementMode).toBe("forum-routed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reuses the creator split for repeat citation payouts", async () => {
    const query = oneCitationQuery();
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const { publicClient, walletClient } = mockClients(
      query.citations[0].wallet,
      1_000_000n,
      124n,
      writes,
      paidSplitIds,
    );

    try {
      await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });
      await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["createSplit", "pay", "pay"]);
      expect(paidSplitIds).toEqual([124n, 124n]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("normalizes legacy split records to the core tenant", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");

    try {
      await writeFile(
        registryPath,
        `${JSON.stringify({
          splits: [
            {
              wallet: "0x7777777777777777777777777777777777777777",
              splitId: "42",
              recipients: ["0x7777777777777777777777777777777777777777"],
              bps: [10_000],
              createSplitTx: `0x${"a".repeat(64)}`,
              createdAt: "2026-07-07T00:00:00.000Z",
            },
          ],
        })}\n`,
        "utf8",
      );

      const registry = await readFeeRouterSplitRegistry(registryPath);

      expect(registry.splits[0]?.tenantId).toBe("citations-core");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps split registry entries isolated by tenant", async () => {
    const query = oneCitationQuery();
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writesA: string[] = [];
    const writesB: string[] = [];
    const clientA = mockClients(
      query.citations[0].wallet,
      1_000_000n,
      126n,
      writesA,
    );
    const clientB = mockClients(
      query.citations[0].wallet,
      1_000_000n,
      127n,
      writesB,
    );

    try {
      await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient: clientA.publicClient,
        walletClient: clientA.walletClient,
        splitRegistryPath: registryPath,
        tenantId: "wp_site_a",
      });
      await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient: clientB.publicClient,
        walletClient: clientB.walletClient,
        splitRegistryPath: registryPath,
        tenantId: "wp_site_b",
      });
      await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient: clientA.publicClient,
        walletClient: clientA.walletClient,
        splitRegistryPath: registryPath,
        tenantId: "wp_site_a",
      });

      const registry = await readFeeRouterSplitRegistry(registryPath);

      expect(registry.splits.map((split) => split.tenantId).sort()).toEqual([
        "wp_site_a",
        "wp_site_b",
      ]);
      expect(writesA).toEqual(["createSplit", "pay", "pay"]);
      expect(writesB).toEqual(["createSplit", "pay"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("assigns unique nonces across concurrent route submissions", async () => {
    const queryA = oneCitationQuery();
    const queryB = oneCitationQuery();
    queryB.citations = queryB.citations.map((citation) => ({
      ...citation,
      sourceId: "nonce-concurrent-source",
      wallet: "0x8888888888888888888888888888888888888888",
    }));
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: ContractCall[] = [];
    let splitId = 300n;
    let pendingSplitId = 300n;
    let pendingRecipients: Address[] = [];
    let pendingBps: number[] = [];
    const publicClient = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "balanceOf") return 1_000_000n;
        if (functionName === "allowance") return 1_000_000n;
        if (functionName === "splitAt") {
          return {
            creator: "0x7777777777777777777777777777777777777777",
            recipients: ["0x7777777777777777777777777777777777777777"],
            bps: [10_000],
            totalRouted: 0n,
            createdAt: 1n,
          };
        }
        throw new Error(`unexpected read ${functionName}`);
      },
      simulateContract: async (request: ContractCall) => {
        splitId += 1n;
        pendingSplitId = splitId;
        pendingRecipients = request.args?.[0] as Address[];
        pendingBps = request.args?.[1] as number[];
        return {
          result: splitId,
          request: {
            ...request,
            account: privateKeyToAccount(TEST_KEY).address,
          },
        };
      },
      getTransactionCount: async () => 200,
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
        status: "success",
        transactionHash: hash,
        logs: [
          splitCreatedLog(
            pendingSplitId,
            privateKeyToAccount(TEST_KEY).address,
            pendingRecipients,
            pendingBps,
          ),
        ],
      }),
    } as unknown as PublicClient;
    const walletClient = {
      writeContract: async (request: ContractCall) => {
        writes.push(request);
        return `0x${"e".repeat(64)}` as Hex;
      },
    } as FeeRouterWalletClient;

    try {
      await Promise.all([
        routeCitationPayments(queryA, {
          enabled: true,
          privateKey: TEST_KEY,
          publicClient,
          walletClient,
          splitRegistryPath: registryPath,
          tenantId: "wp_site_a",
        }),
        routeCitationPayments(queryB, {
          enabled: true,
          privateKey: TEST_KEY,
          publicClient,
          walletClient,
          splitRegistryPath: registryPath,
          tenantId: "wp_site_b",
        }),
      ]);

      const nonces = writes
        .map((write) => write.nonce)
        .sort((left, right) => Number(left) - Number(right));

      expect(nonces).toEqual([200, 201, 202, 203]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates FeeRouter splits from citation contributors", async () => {
    const query = oneCitationQuery();
    query.citations = query.citations.map((citation) => ({
      ...citation,
      contributors: [
        {
          wallet: "0x8888888888888888888888888888888888888888",
          shareBps: 7_000,
        },
        {
          wallet: "0x9999999999999999999999999999999999999999",
          shareBps: 3_000,
        },
      ],
    }));
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const createSplitArgs: unknown[][] = [];
    const { publicClient, walletClient } = mockClients(
      query.citations[0].wallet,
      1_000_000n,
      125n,
      writes,
      [],
      [],
      createSplitArgs,
    );

    try {
      await routeCitationPayments(query, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(createSplitArgs[0]?.[0]).toEqual([
        "0x8888888888888888888888888888888888888888",
        "0x9999999999999999999999999999999999999999",
      ]);
      expect(createSplitArgs[0]?.[1]).toEqual([7_000, 3_000]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("routeEscrowReleasePayment", () => {
  it("rejects a reverted approval before creating a split", async () => {
    const source = DEFAULT_CREATOR_SOURCES[0];
    if (!source) throw new Error("missing test source");
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(
      source.wallet,
      0n,
      201n,
      writes,
    );
    Object.assign(publicClient, {
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
        status: "reverted",
        transactionHash: hash,
        logs: [],
      }),
    });

    await expect(
      routeEscrowReleasePayment(source, 1_000, ["receipt-a"], {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
      }),
    ).rejects.toThrow("FeeRouter escrow approval transaction failed");
    expect(writes).toEqual(["approve"]);
  });

  it("rejects a reverted escrow payout instead of returning evidence", async () => {
    const source = DEFAULT_CREATOR_SOURCES[0];
    if (!source) throw new Error("missing test source");
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-escrow-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(
      source.wallet,
      1_000_000n,
      202n,
      writes,
    );
    const originalWait =
      publicClient.waitForTransactionReceipt.bind(publicClient);
    Object.assign(publicClient, {
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        if (hash === `0x${"c".repeat(64)}`) {
          return {
            status: "reverted",
            transactionHash: hash,
            logs: [],
          };
        }
        return originalWait({ hash });
      },
    });

    try {
      await expect(
        routeEscrowReleasePayment(source, 1_000, ["receipt-a"], {
          enabled: true,
          privateKey: TEST_KEY,
          publicClient,
          walletClient,
          splitRegistryPath: registryPath,
        }),
      ).rejects.toThrow("FeeRouter escrow pay transaction failed");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("refundReaderPayment", () => {
  const READER = "0xdc01ca917f0328f567d718ea25179815fae2db91" as Address;

  it("returns null when refunds are not enabled", async () => {
    expect(await refundReaderPayment(READER, 10_000)).toBeNull();
  });

  it("returns null when the wallet cannot cover the refund", async () => {
    const publicClient = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "balanceOf") return 5_000n;
        throw new Error(`unexpected read ${functionName}`);
      },
      getTransactionCount: async () => 60,
      waitForTransactionReceipt: async () => ({ status: "success" }),
    } as unknown as PublicClient;
    const walletClient = {
      writeContract: async () => {
        throw new Error("must not send when underfunded");
      },
    } as FeeRouterWalletClient;
    expect(
      await refundReaderPayment(READER, 10_000, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
      }),
    ).toBeNull();
  });

  it("transfers USDC back to the reader and returns the tx hash", async () => {
    const writes: ContractCall[] = [];
    const publicClient = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "balanceOf") return 1_000_000n;
        throw new Error(`unexpected read ${functionName}`);
      },
      getTransactionCount: async () => 70,
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
        status: "success",
        transactionHash: hash,
      }),
    } as unknown as PublicClient;
    const walletClient = {
      writeContract: async (request: ContractCall) => {
        writes.push(request);
        return `0x${"d".repeat(64)}` as Hex;
      },
    } as FeeRouterWalletClient;
    const tx = await refundReaderPayment(READER, 10_000, {
      enabled: true,
      privateKey: TEST_KEY,
      publicClient,
      walletClient,
    });
    expect(tx).toBe(`0x${"d".repeat(64)}`);
    expect(writes).toHaveLength(1);
    expect(writes[0].functionName).toBe("transfer");
    expect(writes[0].args?.[0]).toBe(READER);
    expect(writes[0].args?.[1]).toBe(10_000n);
  });

  it("rejects a reverted refund instead of returning its hash", async () => {
    const publicClient = {
      readContract: async ({ functionName }: { functionName: string }) => {
        if (functionName === "balanceOf") return 1_000_000n;
        throw new Error(`unexpected read ${functionName}`);
      },
      getTransactionCount: async () => 71,
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
        status: "reverted",
        transactionHash: hash,
      }),
    } as unknown as PublicClient;
    const walletClient = {
      writeContract: async () => `0x${"f".repeat(64)}` as Hex,
    } as FeeRouterWalletClient;

    await expect(
      refundReaderPayment(READER, 10_000, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
      }),
    ).rejects.toThrow("FeeRouter refund transaction failed");
  });
});
