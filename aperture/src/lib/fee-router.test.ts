import { describe, expect, it } from "vitest";
import type { Hex, PublicClient, WalletClient } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { routeLicensePayment } from "./fee-router";

// A throwaway key generated at runtime — used only to derive a payer address
// locally (no network, never funded).
const TEST_KEY = generatePrivateKey();

const RECIPIENT = "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03";

function mockClients(allowance: bigint, splitCount: bigint, writes: string[]) {
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return 1_000_000n;
      if (functionName === "allowance") return allowance;
      if (functionName === "splitCount") return splitCount;
      throw new Error(`unexpected read ${functionName}`);
    },
    waitForTransactionReceipt: async () => ({ status: "success" }),
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async ({ functionName }: { functionName: string }) => {
      writes.push(functionName);
      return `0x${functionName.padEnd(64, "0")}` as Hex;
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

  it("settles via approve/createSplit/pay and returns forum-routed evidence", async () => {
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(0n, 42n, writes);

    const evidence = await routeLicensePayment(RECIPIENT, 2500, {
      enabled: true,
      privateKey: TEST_KEY,
      publicClient,
      walletClient,
    });

    expect(writes).toEqual(["approve", "createSplit", "pay"]);
    expect(evidence?.settlementMode).toBe("forum-routed");
    expect(evidence?.feeRouterSplitId).toBe("42");
    expect(evidence?.feeRouterPayTx).toBeDefined();
  });

  it("skips the approve when allowance already covers the amount", async () => {
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(1_000_000n, 7n, writes);

    await routeLicensePayment(RECIPIENT, 2500, {
      enabled: true,
      privateKey: TEST_KEY,
      publicClient,
      walletClient,
    });

    expect(writes).toEqual(["createSplit", "pay"]);
  });
});
