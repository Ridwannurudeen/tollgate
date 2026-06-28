import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQueryRecord } from "./engine";
import { assertValidFeeRouterSplit, routeCitationPayments } from "./fee-router";

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
  } as unknown as WalletClient;
  return { publicClient, walletClient };
}

describe("assertValidFeeRouterSplit", () => {
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
});
