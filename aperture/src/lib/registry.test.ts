import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findWalletForOwner,
  readWalletRegistry,
  upsertWalletRegistryEntry,
  writeWalletRegistry,
} from "./registry";

describe("wallet registry", () => {
  it("round-trips entries with checksum addresses", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-registry-"));
    const filePath = path.join(dir, "registry.json");
    try {
      const registry = upsertWalletRegistryEntry(
        { photographers: [] },
        {
          ownerId: "owner-1",
          displayName: "Photographer",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          createdAt: "2026-06-24T00:00:00.000Z",
        },
      );
      await writeWalletRegistry(registry, filePath);
      const read = await readWalletRegistry(filePath);
      expect(findWalletForOwner(read, "owner-1")?.displayName).toBe(
        "Photographer",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a custodial (circle-w3s minted) entry with its walletId", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-registry-"));
    const filePath = path.join(dir, "registry.json");
    try {
      const registry = upsertWalletRegistryEntry(
        { photographers: [] },
        {
          ownerId: "owner-2",
          displayName: "Jane Lens",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          createdAt: "2026-06-26T00:00:00.000Z",
          custody: "circle-w3s",
          walletId: "wallet-abc-123",
        },
      );
      await writeWalletRegistry(registry, filePath);
      const read = await readWalletRegistry(filePath);
      const entry = findWalletForOwner(read, "owner-2");
      expect(entry?.custody).toBe("circle-w3s");
      expect(entry?.walletId).toBe("wallet-abc-123");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
