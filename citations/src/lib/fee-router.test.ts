import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQueryRecord } from "./engine";
import {
  assertValidFeeRouterSplit,
  createFeeRouterPublicClient,
  refundReaderPayment,
  routeCitationPayments,
  type FeeRouterWalletClient,
} from "./fee-router";

const TEST_KEY = generatePrivateKey();

type ContractCall = {
  functionName: string;
  args?: readonly unknown[];
  account?: unknown;
};

function accountAddress(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("address" in value)) {
    return null;
  }
  const address = (value as { address?: unknown }).address;
  return typeof address === "string" ? address : null;
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
) {
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
    simulateContract: async (request: ContractCall) => ({
      result: createSplitId,
      request: {
        ...request,
        account: "0x4164F5B52ecc6F847f03071A287b0B59954cbcEe",
      },
    }),
    waitForTransactionReceipt: async () => ({ status: "success" }),
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

  it("does not escrow creator-claimed external citations", async () => {
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

      expect(evidence[query.citations[0].sourceId]).toBeUndefined();
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
      waitForTransactionReceipt: async () => ({ status: "success" }),
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
});
