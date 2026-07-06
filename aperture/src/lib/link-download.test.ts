import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { handleLinkDownload } from "./link-download";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "./x402-server";
import type { LicenseReceipt, WalletRegistryEntry } from "./types";

const photographer: WalletRegistryEntry = {
  ownerId: "link-owner",
  displayName: "Jane Lens",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-07-06T00:00:00.000Z",
  approvalStatus: "operator-approved",
};

const link = {
  id: "link-1",
  title: "Hidden Origin",
  ownerId: "link-owner",
  sourceUrl: "https://photos.example.com/private/photo.jpg",
  contentType: "image/jpeg",
  sourceContentHash: `0x${"1".repeat(64)}` as Hex,
  priceAtomicUsdc: 2500,
  createdAt: "2026-07-06T00:00:00.000Z",
};

function baseDeps(headers = new Headers()) {
  return {
    headers,
    origin: "https://tollgate.gudman.xyz",
    basePath: "/aperture",
    remoteAddress: "198.51.100.1",
    userAgent: "vitest",
    referer: null,
    findLink: async () => link,
    readWalletForOwner: async () => photographer,
    probeImageSource: async () => ({
      contentType: "image/jpeg",
      sourceContentHash: `0x${"1".repeat(64)}` as Hex,
    }),
  };
}

function fakeReceipt(input: {
  eventId: Hex;
  settlementMode: LicenseReceipt["settlementMode"];
  paymentResource: string;
}): LicenseReceipt {
  return {
    id: "receipt-1",
    eventId: input.eventId,
    assetId: "link-1",
    sharedLinkId: "link-1",
    sharedLinkKeyHash: `0x${"2".repeat(64)}`,
    ownerId: "link-owner",
    photographer: photographer.displayName,
    wallet: photographer.wallet,
    amountAtomicUsdc: 2500,
    settlementMode: input.settlementMode,
    paymentResource: input.paymentResource,
    rawAccessLogHash: `0x${"3".repeat(64)}`,
    previousHash: `0x${"0".repeat(64)}`,
    receiptHash: `0x${"4".repeat(64)}`,
    createdAt: "2026-07-06T00:00:00.000Z",
  };
}

describe("handleLinkDownload", () => {
  it("returns 402 without paying or fetching full bytes when no payment header is supplied", async () => {
    const routeLicensePayment = vi.fn();
    const appendReceipt = vi.fn();
    const fetchImageBytes = vi.fn();
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(),
      routeLicensePayment,
      appendReceipt,
      fetchImageBytes,
    });

    expect(result.status).toBe(402);
    expect(result.headers[PAYMENT_REQUIRED_HEADER]).toBeDefined();
    expect("body" in result && JSON.stringify(result.body)).not.toContain(
      "photos.example.com",
    );
    expect(routeLicensePayment).not.toHaveBeenCalled();
    expect(appendReceipt).not.toHaveBeenCalled();
    expect(fetchImageBytes).not.toHaveBeenCalled();
  });

  it("settles, pays, appends a fresh receipt, and streams the image", async () => {
    const headers = new Headers({ [PAYMENT_SIGNATURE_HEADER]: "paid" });
    const appended: Hex[] = [];
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(headers),
      settlePayment: async () => ({
        ok: true,
        mode: "x402-verified",
        payer: "0x2222222222222222222222222222222222222222",
        responseHeader: "settled",
      }),
      routeLicensePayment: async () => null,
      appendReceipt: async (input) => {
        appended.push(input.eventId);
        expect(input.event.rawLine).not.toContain("photos.example.com");
        return {
          receipt: fakeReceipt({
            eventId: input.eventId,
            settlementMode: input.evidence.settlementMode,
            paymentResource: input.evidence.paymentResource,
          }),
          created: true,
        };
      },
      fetchImageBytes: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/jpeg",
        sourceContentHash: `0x${"1".repeat(64)}` as Hex,
      }),
      now: () => "2026-07-06T00:00:00.000Z",
      eventNonce: () => "nonce-1",
    });

    expect(result.status).toBe(200);
    expect("bytes" in result && Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.headers[PAYMENT_RESPONSE_HEADER]).toBe("settled");
    expect(appended).toHaveLength(1);
  });

  it("does not settle when the pre-payment image probe fails", async () => {
    const settlePayment = vi.fn();
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(new Headers({ [PAYMENT_SIGNATURE_HEADER]: "paid" })),
      probeImageSource: async () => {
        throw new Error("photo URL must return jpeg");
      },
      settlePayment,
    });

    expect(result.status).toBe(502);
    expect("body" in result && JSON.stringify(result.body)).toContain(
      "photo URL must return jpeg",
    );
    expect(settlePayment).not.toHaveBeenCalled();
  });

  it("falls back to x402 evidence when FeeRouter payout throws", async () => {
    let settlementMode: LicenseReceipt["settlementMode"] | null = null;
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(new Headers({ [PAYMENT_SIGNATURE_HEADER]: "paid" })),
      settlePayment: async () => ({
        ok: true,
        mode: "x402-verified",
        responseHeader: "settled",
      }),
      routeLicensePayment: async () => {
        throw new Error("payer drained");
      },
      appendReceipt: async (input) => {
        settlementMode = input.evidence.settlementMode;
        return {
          receipt: fakeReceipt({
            eventId: input.eventId,
            settlementMode: input.evidence.settlementMode,
            paymentResource: input.evidence.paymentResource,
          }),
          created: true,
        };
      },
      fetchImageBytes: async () => ({
        bytes: new Uint8Array([1]),
        contentType: "image/jpeg",
        sourceContentHash: `0x${"1".repeat(64)}` as Hex,
      }),
    });

    expect(result.status).toBe(200);
    expect(settlementMode).toBe("x402-verified");
  });

  it("records the receipt and returns a retryable error if streaming fails after settlement", async () => {
    const appendReceipt = vi.fn(async (input) => ({
      receipt: fakeReceipt({
        eventId: input.eventId,
        settlementMode: input.evidence.settlementMode,
        paymentResource: input.evidence.paymentResource,
      }),
      created: true,
    }));
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(new Headers({ [PAYMENT_SIGNATURE_HEADER]: "paid" })),
      settlePayment: async () => ({
        ok: true,
        mode: "x402-verified",
        responseHeader: "settled",
      }),
      routeLicensePayment: async () => null,
      appendReceipt,
      fetchImageBytes: async () => {
        throw new Error("stream failed");
      },
    });

    expect(result.status).toBe(502);
    expect(result.headers[PAYMENT_RESPONSE_HEADER]).toBe("settled");
    expect("body" in result && JSON.stringify(result.body)).toContain(
      "receiptHash",
    );
    expect(appendReceipt).toHaveBeenCalledTimes(1);
  });
});
