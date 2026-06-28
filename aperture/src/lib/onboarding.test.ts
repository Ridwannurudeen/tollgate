import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { registerCreator } from "./onboarding";
import { readWalletRegistry } from "./registry";

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
});
