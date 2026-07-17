import { describe, expect, it } from "vitest";
import { processAccessLogLine } from "./watcher";
import type { LicenseReceipt } from "./types";

const line =
  '127.0.0.1 - - [24/Jun/2026:07:45:36 +0200] "POST /api/download/archive?key=abc123 HTTP/2.0" 200 150 "-" "browser"';

const existing: LicenseReceipt = {
  id: "receipt",
  eventId: "0x1111111111111111111111111111111111111111111111111111111111111111",
  assetId: "asset-1",
  sharedLinkId: "share-1",
  sharedLinkKeyHash:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  ownerId: "owner-1",
  photographer: "Photographer",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  amountAtomicUsdc: 2500,
  settlementMode: "forum-routed",
  paymentResource: "forum-fee-router",
  rawAccessLogHash:
    "0x3333333333333333333333333333333333333333333333333333333333333333",
  previousHash:
    "0x0000000000000000000000000000000000000000000000000000000000000000",
  receiptHash:
    "0x4444444444444444444444444444444444444444444444444444444444444444",
  createdAt: "2026-06-24T07:45:36.000Z",
};

function resolvedLink() {
  return {
    id: "share-1",
    key: "abc123",
    type: "INDIVIDUAL" as const,
    allowDownload: true,
    assets: [
      {
        id: "asset-1",
        ownerId: "owner-1",
        originalFileName: "photo.png",
      },
    ],
  };
}

describe("processAccessLogLine", () => {
  it("ignores failed archive events before resolving or reading receipts", async () => {
    let resolveCalls = 0;
    let ledgerReads = 0;
    const result = await processAccessLogLine(
      '127.0.0.1 - - [24/Jun/2026:07:45:36 +0200] "POST /api/download/archive?key=abc123 HTTP/2.0" 403 150 "-" "browser"',
      {
        immichApiBaseUrl: "http://immich.local/api",
        resolveSharedLink: async () => {
          resolveCalls += 1;
          return resolvedLink();
        },
        readLedger: async () => {
          ledgerReads += 1;
          return { receipts: [] };
        },
      },
    );

    expect(result.kind).toBe("ignored");
    expect(resolveCalls).toBe(0);
    expect(ledgerReads).toBe(0);
  });

  it("observes the existing gate receipt without writing another payout", async () => {
    const result = await processAccessLogLine(line, {
      immichApiBaseUrl: "http://immich.local/api",
      resolveSharedLink: async () => resolvedLink(),
      readLedger: async () => ({ receipts: [existing] }),
    });

    expect(result.kind).toBe("processed");
    if (result.kind === "processed") {
      expect(result.receipts).toEqual([existing]);
      expect(result.unresolvedOwnerIds).toEqual([]);
    }
  });

  it("reports assets without a gate receipt instead of settling them", async () => {
    const result = await processAccessLogLine(line, {
      immichApiBaseUrl: "http://immich.local/api",
      resolveSharedLink: async () => resolvedLink(),
      readLedger: async () => ({ receipts: [] }),
    });

    expect(result.kind).toBe("processed");
    if (result.kind === "processed") {
      expect(result.receipts).toEqual([]);
      expect(result.unresolvedOwnerIds).toEqual(["owner-1"]);
    }
  });
});
