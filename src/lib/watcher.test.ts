import { describe, expect, it } from "vitest";
import { processAccessLogLine } from "./watcher";
import type { LicenseReceiptInput } from "./ledger";
import type { LicenseReceipt, WalletRegistryEntry } from "./types";

const line =
  '127.0.0.1 - - [24/Jun/2026:07:45:36 +0200] "POST /api/download/archive?key=abc123 HTTP/2.0" 200 150 "-" "browser"';

const photographer: WalletRegistryEntry = {
  ownerId: "owner-1",
  displayName: "Photographer",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-06-24T00:00:00.000Z",
};

describe("processAccessLogLine", () => {
  it("resolves shared-link assets and appends receipts", async () => {
    const appended: LicenseReceiptInput[] = [];
    const result = await processAccessLogLine(line, {
      immichApiBaseUrl: "http://immich.local/api",
      amountAtomicUsdc: 2500,
      resolveSharedLink: async () => ({
        id: "share-1",
        key: "abc123",
        assets: [
          {
            id: "asset-1",
            ownerId: "owner-1",
            originalFileName: "photo.png",
            originalPath: "/library/photo.png",
          },
        ],
      }),
      findWalletForOwner: async () => photographer,
      readExifCredit: async () => ({
        sourcePath: "/library/photo.png",
        artist: "Photographer",
        copyright: null,
      }),
      settle: async () => null,
      appendReceipt: async (input) => {
        appended.push(input);
        return {
          created: true,
          receipt: {
            id: "receipt",
            eventId: input.eventId,
            assetId: input.assetId,
            sharedLinkId: input.sharedLinkId,
            sharedLinkKeyHash:
              "0x2222222222222222222222222222222222222222222222222222222222222222",
            ownerId: input.ownerId,
            photographer: input.photographer.displayName,
            wallet: input.photographer.wallet,
            amountAtomicUsdc: input.amountAtomicUsdc,
            settlementMode: "local-proof",
            paymentResource: "immich-access-log",
            rawAccessLogHash:
              "0x3333333333333333333333333333333333333333333333333333333333333333",
            previousHash:
              "0x0000000000000000000000000000000000000000000000000000000000000000",
            receiptHash:
              "0x4444444444444444444444444444444444444444444444444444444444444444",
            createdAt: input.event.createdAt,
          } satisfies LicenseReceipt,
        };
      },
    });

    expect(result.kind).toBe("processed");
    expect(appended).toHaveLength(1);
    expect(appended[0].assetId).toBe("asset-1");
    expect(appended[0].exifCredit?.artist).toBe("Photographer");
  });

  it("does not settle again for an already-recorded event (idempotent, no double-pay)", async () => {
    const hex = (b: string) => `0x${b.repeat(32)}` as `0x${string}`;
    let settleCalls = 0;
    let appendCalls = 0;
    const existing: LicenseReceipt = {
      id: "existing",
      eventId: hex("11"),
      assetId: "asset-1",
      sharedLinkId: "share-1",
      sharedLinkKeyHash: hex("22"),
      ownerId: "owner-1",
      photographer: "Photographer",
      wallet: photographer.wallet,
      amountAtomicUsdc: 2500,
      settlementMode: "forum-routed",
      paymentResource: "forum-fee-router",
      rawAccessLogHash: hex("33"),
      previousHash: hex("00"),
      receiptHash: hex("44"),
      createdAt: "2026-06-24T07:45:36.000Z",
    };

    const result = await processAccessLogLine(line, {
      immichApiBaseUrl: "http://immich.local/api",
      amountAtomicUsdc: 2500,
      resolveSharedLink: async () => ({
        id: "share-1",
        key: "abc123",
        assets: [
          {
            id: "asset-1",
            ownerId: "owner-1",
            originalFileName: "photo.png",
            originalPath: "/library/photo.png",
          },
        ],
      }),
      findWalletForOwner: async () => photographer,
      findExistingReceipt: async () => existing,
      settle: async () => {
        settleCalls += 1;
        return null;
      },
      appendReceipt: async () => {
        appendCalls += 1;
        return { created: false, receipt: existing };
      },
    });

    expect(settleCalls).toBe(0);
    expect(appendCalls).toBe(0);
    expect(result.kind).toBe("processed");
    if (result.kind === "processed") {
      expect(result.receipts).toHaveLength(1);
      expect(result.receipts[0]).toBe(existing);
    }
  });
});
