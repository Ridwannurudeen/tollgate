import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Hex, PublicClient, WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { routeLicensePayment } from "./fee-router";

// A throwaway key generated at runtime — used only to derive a payer address
// locally (no network, never funded).
const TEST_KEY = generatePrivateKey();

const RECIPIENT = "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03";

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

function mockClients(
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
          creator: RECIPIENT,
          recipients: [RECIPIENT],
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

describe("routeLicensePayment", () => {
  it("returns null when FeeRouter settlement is disabled", async () => {
    await expect(
      routeLicensePayment(RECIPIENT, 2500, { enabled: false }),
    ).resolves.toBeNull();
  });

  it("requires a private key when enabled", async () => {
    await expect(
      routeLicensePayment(RECIPIENT, 2500, { enabled: true }),
    ).rejects.toThrow("APERTURE_FEE_ROUTER_PRIVATE_KEY");
  });

  it("settles via approve/createSplit/pay and pays the simulated split id", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const createSplitAccounts: unknown[] = [];
    const { publicClient, walletClient } = mockClients(
      0n,
      77n,
      writes,
      paidSplitIds,
      createSplitAccounts,
    );

    try {
      const evidence = await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["approve", "createSplit", "pay"]);
      expect(paidSplitIds).toEqual([77n]);
      expect(accountAddress(createSplitAccounts[0])).toBe(
        privateKeyToAccount(TEST_KEY).address,
      );
      expect(evidence?.settlementMode).toBe("forum-routed");
      expect(evidence?.feeRouterSplitId).toBe("77");
      expect(evidence?.feeRouterPayTx).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips the approve when allowance already covers the amount", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(1_000_000n, 7n, writes);

    try {
      await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["createSplit", "pay"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reuses the persisted split for repeat creator payouts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const { publicClient, walletClient } = mockClients(
      1_000_000n,
      81n,
      writes,
      paidSplitIds,
    );

    try {
      await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });
      await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["createSplit", "pay", "pay"]);
      expect(paidSplitIds).toEqual([81n, 81n]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
