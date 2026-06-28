import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import {
  LOCAL_PROOF_HEADER,
  handleLicenseDownload,
} from "./license-download";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "./x402-server";
import type { LicenseReceipt, WalletRegistryEntry } from "./types";

const photographer: WalletRegistryEntry = {
  ownerId: "owner-1",
  displayName: "Photographer",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-06-24T00:00:00.000Z",
  approvalStatus: "operator-approved",
};

function sharedLink() {
  return {
    id: "share-1",
    key: "abc123",
    assets: [
      {
        id: "asset-1",
        ownerId: "owner-1",
        originalFileName: "photo.png",
      },
    ],
  };
}

function fakeReceipt(input: {
  eventId: Hex;
  assetId: string;
  sharedLinkId: string;
  ownerId: string;
  photographer: WalletRegistryEntry;
  amountAtomicUsdc: number;
  settlementMode: LicenseReceipt["settlementMode"];
}): LicenseReceipt {
  return {
    id: "receipt-1",
    eventId: input.eventId,
    assetId: input.assetId,
    sharedLinkId: input.sharedLinkId,
    sharedLinkKeyHash: `0x${"1".repeat(64)}`,
    ownerId: input.ownerId,
    photographer: input.photographer.displayName,
    wallet: input.photographer.wallet,
    amountAtomicUsdc: input.amountAtomicUsdc,
    settlementMode: input.settlementMode,
    paymentResource: "x402-license-download:share-1",
    rawAccessLogHash: `0x${"2".repeat(64)}`,
    previousHash: `0x${"0".repeat(64)}`,
    receiptHash: `0x${"3".repeat(64)}`,
    createdAt: "2026-06-27T12:00:00.000Z",
  };
}

describe("handleLicenseDownload", () => {
  it("returns a 402 x402 requirement when no payment is supplied", async () => {
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers: new Headers(),
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        collectorAddress: "0x1111111111111111111111111111111111111111",
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
        routeLicensePayment: async () => null,
        appendReceipt: async () => {
          throw new Error("unpaid request should not append");
        },
      },
    );

    expect(result.status).toBe(402);
    expect(result.headers[PAYMENT_REQUIRED_HEADER]).toBeDefined();
  });

  it("unlocks and appends a receipt after an accepted x402 payment", async () => {
    let payoutCalls = 0;
    const appended: LicenseReceipt[] = [];
    const headers = new Headers({ [PAYMENT_SIGNATURE_HEADER]: "paid" });
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers,
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        collectorAddress: "0x1111111111111111111111111111111111111111",
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
        routeLicensePayment: async () => {
          payoutCalls += 1;
          return null;
        },
        settlePayment: async () => ({
          ok: true,
          mode: "x402-verified",
          payer: "0x2222222222222222222222222222222222222222",
          responseHeader: "settled",
        }),
        appendReceipt: async (input) => {
          const receipt = fakeReceipt({
            eventId: input.eventId,
            assetId: input.assetId,
            sharedLinkId: input.sharedLinkId,
            ownerId: input.ownerId,
            photographer: input.photographer,
            amountAtomicUsdc: input.amountAtomicUsdc,
            settlementMode: input.evidence.settlementMode,
          });
          appended.push(receipt);
          return { receipt, created: true };
        },
        now: () => "2026-06-27T12:00:00.000Z",
      },
    );

    expect(result.status).toBe(200);
    expect(result.headers[PAYMENT_RESPONSE_HEADER]).toBe("settled");
    expect(payoutCalls).toBe(1);
    expect(appended).toHaveLength(1);
    expect(appended[0].settlementMode).toBe("x402-verified");
  });

  it("supports explicit local-proof unlocks only when enabled", async () => {
    const headers = new Headers({ [LOCAL_PROOF_HEADER]: "1" });
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers,
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        localProofEnabled: true,
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
        routeLicensePayment: async () => null,
        appendReceipt: async (input) => {
          const receipt = fakeReceipt({
            eventId: input.eventId,
            assetId: input.assetId,
            sharedLinkId: input.sharedLinkId,
            ownerId: input.ownerId,
            photographer: input.photographer,
            amountAtomicUsdc: input.amountAtomicUsdc,
            settlementMode: input.evidence.settlementMode,
          });
          return { receipt, created: true };
        },
      },
    );

    expect(result.status).toBe(200);
  });
});
