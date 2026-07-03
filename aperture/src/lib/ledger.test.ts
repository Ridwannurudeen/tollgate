import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendLicenseReceipt,
  readLicenseLedger,
  verifyLicenseLedger,
} from "./ledger";
import type { DownloadArchiveEvent, WalletRegistryEntry } from "./types";

const event: DownloadArchiveEvent = {
  remoteAddress: "127.0.0.1",
  method: "POST",
  path: "/api/download/archive",
  sharedLinkKey: "share-key",
  status: 200,
  userAgent: "browser",
  referer: null,
  createdAt: "2026-06-24T05:45:36.000Z",
  rawLine: "raw",
};

const photographer: WalletRegistryEntry = {
  ownerId: "owner-1",
  displayName: "Photographer",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-06-24T00:00:00.000Z",
  approvalStatus: "operator-approved",
};

describe("license ledger", () => {
  it("appends idempotent hash-chained receipts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-ledger-"));
    const filePath = path.join(dir, "ledger.json");
    try {
      const first = await appendLicenseReceipt(
        {
          eventId:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          event,
          sharedLinkId: "share-1",
          assetId: "asset-1",
          ownerId: "owner-1",
          photographer,
          amountAtomicUsdc: 2500,
          evidence: {
            settlementMode: "local-proof",
            paymentResource: "immich-access-log",
          },
        },
        filePath,
      );
      const second = await appendLicenseReceipt(
        {
          eventId:
            "0x1111111111111111111111111111111111111111111111111111111111111111",
          event,
          sharedLinkId: "share-1",
          assetId: "asset-1",
          ownerId: "owner-1",
          photographer,
          amountAtomicUsdc: 2500,
          evidence: {
            settlementMode: "local-proof",
            paymentResource: "immich-access-log",
          },
        },
        filePath,
      );
      const ledger = await readLicenseLedger(filePath);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(ledger.receipts).toHaveLength(1);
      expect(verifyLicenseLedger(ledger).ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes concurrent receipt appends without dropping events", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-ledger-"));
    const filePath = path.join(dir, "ledger.json");
    try {
      await Promise.all(
        ["11", "22", "33"].map((byte, index) =>
          appendLicenseReceipt(
            {
              eventId: `0x${byte.repeat(32)}`,
              event: {
                ...event,
                rawLine: `raw-${index}`,
                createdAt: `2026-06-24T05:45:3${index}.000Z`,
              },
              sharedLinkId: "share-1",
              assetId: `asset-${index}`,
              ownerId: "owner-1",
              photographer,
              amountAtomicUsdc: 2500,
              evidence: {
                settlementMode: "local-proof",
                paymentResource: "immich-access-log",
              },
            },
            filePath,
          ),
        ),
      );

      const ledger = await readLicenseLedger(filePath);
      const verification = verifyLicenseLedger(ledger);

      expect(ledger.receipts).toHaveLength(3);
      expect(verification.ok).toBe(true);
      expect(verification.latestHash).toBe(
        ledger.receipts.at(-1)?.receiptHash,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads and appends against SQLite when ledger.db exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-ledger-db-"));
    const filePath = path.join(dir, "ledger.json");
    const dbPath = path.join(dir, "ledger.db");
    try {
      await writeFile(dbPath, "");
      await appendLicenseReceipt(
        {
          eventId:
            "0x4444444444444444444444444444444444444444444444444444444444444444",
          event,
          sharedLinkId: "share-1",
          assetId: "asset-1",
          ownerId: "owner-1",
          photographer,
          amountAtomicUsdc: 2500,
          evidence: {
            settlementMode: "local-proof",
            paymentResource: "immich-access-log",
          },
        },
        filePath,
      );

      const ledger = await readLicenseLedger(filePath);
      const verification = verifyLicenseLedger(ledger);

      expect(ledger.receipts).toHaveLength(1);
      expect(verification.ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
