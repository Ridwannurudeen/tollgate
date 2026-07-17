import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildOwnerOwnershipMessage, registerCreator } from "./onboarding";
import { readWalletRegistry, writeWalletRegistry } from "./registry";

const mocks = vi.hoisted(() => ({
  w3sMintWallet: vi.fn(),
}));

vi.mock("./circle-w3s", () => ({
  w3sMintWallet: mocks.w3sMintWallet,
}));

async function withTempRegistry(
  run: (filePath: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-onboarding-"));
  try {
    await run(path.join(dir, "registry.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("registerCreator", () => {
  beforeEach(() => {
    mocks.w3sMintWallet.mockReset();
  });

  it("self-custody: registers the supplied wallet and persists it", async () => {
    await withTempRegistry(async (filePath) => {
      const entry = await registerCreator({
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12f25b721cc21c38495e33a4c8524dd0b647ba03",
        filePath,
      });
      expect(entry.custody).toBe("self");
      expect(entry.approvalStatus).toBe("pending");
      // address is checksummed on the way in
      expect(entry.wallet).toBe("0x12F25B721Cc21c38495e33A4c8524dd0B647ba03");
      const registry = await readWalletRegistry(filePath);
      expect(registry.photographers).toHaveLength(1);
    });
  });

  it("rejects an invalid wallet", async () => {
    await withTempRegistry(async (filePath) => {
      await expect(
        registerCreator({
          ownerId: "owner-1",
          displayName: "Jane Lens",
          wallet: "not-an-address",
          filePath,
        }),
      ).rejects.toThrow("valid EVM address");
    });
  });

  it("requires ownerId and displayName", async () => {
    await withTempRegistry(async (filePath) => {
      await expect(
        registerCreator({ ownerId: "", displayName: "Jane", filePath }),
      ).rejects.toThrow("required");
    });
  });

  it("stores normalized emails and rejects duplicates across owners", async () => {
    await withTempRegistry(async (filePath) => {
      const first = await registerCreator({
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12f25b721cc21c38495e33a4c8524dd0b647ba03",
        email: " Jane@Example.COM ",
        filePath,
      });

      expect(first.email).toBe("jane@example.com");
      await expect(
        registerCreator({
          ownerId: "owner-2",
          displayName: "Other Lens",
          wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          email: "jane@example.com",
          filePath,
        }),
      ).rejects.toThrow("email already registered");
    });
  });

  it("self-custody: a valid ownership signature marks the entry wallet-signed", async () => {
    await withTempRegistry(async (filePath) => {
      const account = privateKeyToAccount(generatePrivateKey());
      // Fresh timestamp: ownershipProofFromInput now rejects stale proofs.
      const timestamp = new Date().toISOString();
      const signature = await account.signMessage({
        message: buildOwnerOwnershipMessage({
          ownerId: "owner-1",
          wallet: account.address,
          timestamp,
        }),
      });
      const entry = await registerCreator({
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: account.address,
        ownershipSignature: signature,
        ownershipTimestamp: timestamp,
        filePath,
      });
      expect(entry.approvalStatus).toBe("wallet-signed");
      expect(entry.ownershipProof?.method).toBe("wallet-signature");
      expect(entry.ownershipProof?.signer).toBe(account.address);
    });
  });

  it("self-custody: rejects a signature that does not recover the wallet", async () => {
    await withTempRegistry(async (filePath) => {
      const account = privateKeyToAccount(generatePrivateKey());
      const timestamp = "2026-06-28T00:00:00.000Z";
      // Sign a different timestamp than the one submitted, so the rebuilt
      // message does not match and recovery fails.
      const signature = await account.signMessage({
        message: buildOwnerOwnershipMessage({
          ownerId: "owner-1",
          wallet: account.address,
          timestamp: "2020-01-01T00:00:00.000Z",
        }),
      });
      await expect(
        registerCreator({
          ownerId: "owner-1",
          displayName: "Jane Lens",
          wallet: account.address,
          ownershipSignature: signature,
          ownershipTimestamp: timestamp,
          filePath,
        }),
      ).rejects.toThrow("did not recover");
    });
  });

  it("custodial path needs a wallet set when no wallet is supplied", async () => {
    const saved = process.env.CIRCLE_WALLET_SET_ID;
    delete process.env.CIRCLE_WALLET_SET_ID;
    try {
      await withTempRegistry(async (filePath) => {
        await expect(
          registerCreator({
            ownerId: "owner-1",
            displayName: "Jane Lens",
            filePath,
          }),
        ).rejects.toThrow("CIRCLE_WALLET_SET_ID");
      });
    } finally {
      if (saved !== undefined) process.env.CIRCLE_WALLET_SET_ID = saved;
    }
  });

  it("rejects an existing owner before minting a replacement wallet", async () => {
    await withTempRegistry(async (filePath) => {
      const existing = {
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03" as const,
        createdAt: "2026-07-06T00:00:00.000Z",
        approvalStatus: "operator-approved" as const,
        linkedWallets: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      };
      await writeWalletRegistry(
        {
          photographers: [existing],
        },
        filePath,
      );
      mocks.w3sMintWallet.mockResolvedValue({
        id: "wallet-attacker",
        address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        blockchain: "ARC-TESTNET",
        state: "LIVE",
      });

      await expect(
        registerCreator({
          ownerId: "owner-1",
          displayName: "Attacker",
          walletSetId: "wallet-set",
          filePath,
        }),
      ).rejects.toThrow("ownerId already registered");

      expect(mocks.w3sMintWallet).not.toHaveBeenCalled();
      const registry = await readWalletRegistry(filePath);
      expect(registry.photographers).toEqual([existing]);
    });
  });

  it("allows only one concurrent registration for an owner ID", async () => {
    await withTempRegistry(async (filePath) => {
      const attempts = await Promise.allSettled([
        registerCreator({
          ownerId: "owner-1",
          displayName: "Jane Lens",
          wallet: "0x12f25b721cc21c38495e33a4c8524dd0b647ba03",
          filePath,
        }),
        registerCreator({
          ownerId: "owner-1",
          displayName: "Attacker",
          wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          filePath,
        }),
      ]);

      const fulfilled = attempts.filter(
        (attempt) => attempt.status === "fulfilled",
      );
      const rejected = attempts.filter(
        (attempt) => attempt.status === "rejected",
      );
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: new Error("ownerId already registered."),
      });

      const registry = await readWalletRegistry(filePath);
      expect(registry.photographers).toHaveLength(1);
      expect(registry.photographers[0]).toMatchObject(
        fulfilled[0].status === "fulfilled" ? fulfilled[0].value : {},
      );
    });
  });
});
