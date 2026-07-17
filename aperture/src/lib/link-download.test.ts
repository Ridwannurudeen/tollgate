import { encodePaymentSignatureHeader } from "@x402/core/http";
import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import {
  handleLinkDownload,
  type LinkDownloadDeps,
} from "./link-download";
import type {
  LicensePurchase,
  LicensePurchaseStore,
} from "./license-purchase";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  buildExactPaymentRequirements,
  type X402Settlement,
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

function paymentHeader(nonce = "11"): string {
  const requirements = buildExactPaymentRequirements(
    photographer.wallet,
    link.priceAtomicUsdc,
  );
  return encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: requirements,
    payload: {
      signature: `0x${"00".repeat(65)}`,
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: requirements.payTo,
        value: requirements.amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${nonce.repeat(32)}`,
      },
    },
  });
}

function paidHeaders(nonce = "11"): Headers {
  return new Headers({ [PAYMENT_SIGNATURE_HEADER]: paymentHeader(nonce) });
}

function settled(): Extract<X402Settlement, { ok: true }> {
  return {
    ok: true,
    mode: "x402-settled",
    payer: "0x2222222222222222222222222222222222222222",
    transaction: `0x${"3".repeat(64)}`,
    responseHeader: "settled",
  };
}

function settleAfterMedia(
  settlement: Extract<X402Settlement, { ok: true }> = settled(),
): NonNullable<LinkDownloadDeps["settlePayment"]> {
  return async (_signature, _requirements, beforeSettle) => {
    await beforeSettle?.();
    return settlement;
  };
}

function memoryPurchaseStore(): LicensePurchaseStore {
  const purchases = new Map<Hex, LicensePurchase>();
  return {
    async reserve(paymentId, snapshotHash) {
      const existing = purchases.get(paymentId);
      if (existing) return { created: false, purchase: existing };
      const purchase: LicensePurchase = {
        paymentId,
        snapshotHash,
        state: "reserved",
      };
      purchases.set(paymentId, purchase);
      return { created: true, purchase };
    },
    async markSettled(
      paymentId,
      snapshotHash,
      settlement,
      authorizationExpiresAt,
    ) {
      purchases.set(paymentId, {
        paymentId,
        snapshotHash,
        state: "settled",
        settlement,
        authorizationExpiresAt,
      });
    },
    async markReceipted(paymentId) {
      const purchase = purchases.get(paymentId);
      if (!purchase) throw new Error("missing purchase");
      purchases.set(paymentId, { ...purchase, state: "receipted" });
    },
    async release(paymentId) {
      if (purchases.get(paymentId)?.state === "reserved") {
        purchases.delete(paymentId);
      }
    },
  };
}

function baseDeps(headers = new Headers()) {
  return {
    headers,
    origin: "https://tollgate.gudman.xyz",
    basePath: "/aperture",
    remoteAddress: "198.51.100.1",
    userAgent: "vitest",
    referer: null,
    purchaseStore: memoryPurchaseStore(),
    findLink: async () => link,
    readWalletForOwner: async () => photographer,
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
    const appendReceipt = vi.fn();
    const fetchImageBytes = vi.fn();
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(),
      appendReceipt,
      fetchImageBytes,
    });

    expect(result.status).toBe(402);
    expect(result.headers[PAYMENT_REQUIRED_HEADER]).toBeDefined();
    expect("body" in result && JSON.stringify(result.body)).not.toContain(
      "photos.example.com",
    );
    expect(appendReceipt).not.toHaveBeenCalled();
    expect(fetchImageBytes).not.toHaveBeenCalled();
  });

  it("settles, pays, appends a fresh receipt, and streams the image", async () => {
    const headers = paidHeaders();
    const appended: Hex[] = [];
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(headers),
      settlePayment: settleAfterMedia({
        ...settled(),
        mode: "x402-verified",
      }),
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
    });

    expect(result.status).toBe(200);
    expect("bytes" in result && Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.headers[PAYMENT_RESPONSE_HEADER]).toBe("settled");
    expect(appended).toHaveLength(1);
  });

  it("rejects an invalid payment before fetching hosted bytes", async () => {
    const fetchImageBytes = vi.fn();
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(paidHeaders()),
      fetchImageBytes,
      settlePayment: async () => ({
        ok: false,
        status: 402,
        reason: "invalid payment",
      }),
    });

    expect(result.status).toBe(402);
    expect(fetchImageBytes).not.toHaveBeenCalled();
  });

  it("records direct-to-creator x402 evidence", async () => {
    let settlementMode: LicenseReceipt["settlementMode"] | null = null;
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(paidHeaders()),
      settlePayment: settleAfterMedia({
        ...settled(),
        mode: "x402-verified",
      }),
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

  it("loads the exact media before settlement and then streams it", async () => {
    let paymentSettled = false;
    const fetchImageBytes = vi.fn(async () => {
      if (paymentSettled) {
        throw new Error("media was loaded after settlement");
      }
      return {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/jpeg",
        sourceContentHash: `0x${"1".repeat(64)}` as Hex,
      };
    });

    const result = await handleLinkDownload("link-1", {
      ...baseDeps(paidHeaders()),
      purchaseStore: memoryPurchaseStore(),
      settlePayment: async (_signature, _requirements, beforeSettle) => {
        await beforeSettle?.();
        paymentSettled = true;
        return settled();
      },
      appendReceipt: async (input) => ({
        receipt: fakeReceipt({
          eventId: input.eventId,
          settlementMode: input.evidence.settlementMode,
          paymentResource: input.evidence.paymentResource,
        }),
        created: true,
      }),
      fetchImageBytes,
    });

    expect(result.status).toBe(200);
    expect(fetchImageBytes).toHaveBeenCalledTimes(1);
    expect(paymentSettled).toBe(true);
  });

  it("resumes a paid download after a receipt outage without settling twice", async () => {
    const settlePayment = vi.fn(
      async (_signature, _requirements, beforeSettle) => {
        await beforeSettle?.();
        return settled();
      },
    );
    const appendReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error("ledger unavailable"))
      .mockImplementationOnce(async (input) => ({
        receipt: fakeReceipt({
          eventId: input.eventId,
          settlementMode: input.evidence.settlementMode,
          paymentResource: input.evidence.paymentResource,
        }),
        created: true,
      }));
    const purchaseStore = memoryPurchaseStore();
    const deps = {
      ...baseDeps(paidHeaders()),
      purchaseStore,
      settlePayment,
      appendReceipt,
      fetchImageBytes: async () => ({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "image/jpeg",
        sourceContentHash: `0x${"1".repeat(64)}` as Hex,
      }),
    };

    const first = await handleLinkDownload("link-1", deps);
    const retried = await handleLinkDownload("link-1", deps);

    expect(first.status).toBe(200);
    expect(first.headers["x-aperture-receipt-status"]).toBe("pending");
    expect(retried.status).toBe(200);
    expect(retried.headers["x-aperture-receipt-status"]).toBe("recorded");
    expect(settlePayment).toHaveBeenCalledTimes(1);
    expect(appendReceipt.mock.calls[0][0].eventId).toBe(
      appendReceipt.mock.calls[1][0].eventId,
    );
  });

  it("does not settle or append a receipt when media loading fails after verification", async () => {
    let settlementCompleted = false;
    const appendReceipt = vi.fn();
    const result = await handleLinkDownload("link-1", {
      ...baseDeps(paidHeaders()),
      settlePayment: async (_signature, _requirements, beforeSettle) => {
        await beforeSettle?.();
        settlementCompleted = true;
        return settled();
      },
      appendReceipt,
      fetchImageBytes: async () => {
        throw new Error("stream failed");
      },
    });

    expect(result.status).toBe(502);
    expect(result.headers[PAYMENT_RESPONSE_HEADER]).toBeUndefined();
    expect(settlementCompleted).toBe(false);
    expect(appendReceipt).not.toHaveBeenCalled();
  });

  it("settles and streams stored original bytes for upload links", async () => {
    const fetchImageBytes = vi.fn();
    const readLinkOriginal = vi.fn(async () => new Uint8Array([7, 8, 9]));
    const result = await handleLinkDownload("upload-1", {
      ...baseDeps(paidHeaders()),
      findLink: async () => ({
        id: "upload-1",
        title: "Uploaded Origin",
        ownerId: "link-owner",
        sourceKind: "upload",
        originalContentType: "image/png",
        sourceContentHash: `0x${"5".repeat(64)}` as Hex,
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-06T00:00:00.000Z",
      }),
      fetchImageBytes,
      assertLinkOriginalReadable: async () => {},
      readLinkOriginal,
      settlePayment: settleAfterMedia({
        ...settled(),
        mode: "x402-verified",
      }),
      appendReceipt: async (input) => ({
        receipt: fakeReceipt({
          eventId: input.eventId,
          settlementMode: input.evidence.settlementMode,
          paymentResource: input.evidence.paymentResource,
        }),
        created: true,
      }),
    });

    expect(result.status).toBe(200);
    expect("bytes" in result && Array.from(result.bytes)).toEqual([7, 8, 9]);
    expect(result.headers["content-type"]).toBe("image/png");
    expect(result.headers["content-disposition"]).toContain(
      "uploaded-origin.png",
    );
    expect(readLinkOriginal).toHaveBeenCalledWith("upload-1", "png");
    expect(fetchImageBytes).not.toHaveBeenCalled();
  });

  it("settles and streams stored original bytes for video upload links", async () => {
    const readLinkOriginal = vi.fn(async () => new Uint8Array([10, 11, 12]));
    const result = await handleLinkDownload("video-1", {
      ...baseDeps(paidHeaders()),
      findLink: async () => ({
        id: "video-1",
        title: "Uploaded Clip",
        ownerId: "link-owner",
        mediaKind: "video",
        sourceKind: "upload",
        originalContentType: "video/mp4",
        sourceContentHash: `0x${"6".repeat(64)}` as Hex,
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-06T00:00:00.000Z",
      }),
      assertLinkOriginalReadable: async () => {},
      readLinkOriginal,
      settlePayment: settleAfterMedia({
        ...settled(),
        mode: "x402-verified",
      }),
      appendReceipt: async (input) => ({
        receipt: fakeReceipt({
          eventId: input.eventId,
          settlementMode: input.evidence.settlementMode,
          paymentResource: input.evidence.paymentResource,
        }),
        created: true,
      }),
    });

    expect(result.status).toBe(200);
    expect("bytes" in result && Array.from(result.bytes)).toEqual([10, 11, 12]);
    expect(result.headers["content-type"]).toBe("video/mp4");
    expect(result.headers["content-disposition"]).toContain(
      "uploaded-clip.mp4",
    );
    expect(readLinkOriginal).toHaveBeenCalledWith("video-1", "mp4");
  });

  it("describes unpaid video upload links as video downloads", async () => {
    const result = await handleLinkDownload("video-1", {
      ...baseDeps(),
      findLink: async () => ({
        id: "video-1",
        title: "Uploaded Clip",
        ownerId: "link-owner",
        mediaKind: "video",
        sourceKind: "upload",
        originalContentType: "video/mp4",
        sourceContentHash: `0x${"6".repeat(64)}` as Hex,
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-06T00:00:00.000Z",
      }),
      assertLinkOriginalReadable: async () => {},
    });

    expect(result.status).toBe(402);
    expect("body" in result && JSON.stringify(result.body)).toContain(
      "Paid Aperture video download.",
    );
  });

  it("does not settle when uploaded video loading fails after verification", async () => {
    const result = await handleLinkDownload("video-1", {
      ...baseDeps(paidHeaders()),
      findLink: async () => ({
        id: "video-1",
        title: "Uploaded Clip",
        ownerId: "link-owner",
        mediaKind: "video",
        sourceKind: "upload",
        originalContentType: "video/mp4",
        sourceContentHash: `0x${"6".repeat(64)}` as Hex,
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-06T00:00:00.000Z",
      }),
      assertLinkOriginalReadable: async () => {},
      readLinkOriginal: async () => {
        throw new Error("missing");
      },
      settlePayment: settleAfterMedia({
        ...settled(),
        mode: "x402-verified",
      }),
    });

    expect(result.status).toBe(410);
    expect("body" in result && JSON.stringify(result.body)).toContain(
      "uploaded video is no longer available",
    );
  });

  it("does not read full upload bytes when payment settlement fails", async () => {
    const readLinkOriginal = vi.fn();
    const result = await handleLinkDownload("upload-1", {
      ...baseDeps(paidHeaders()),
      findLink: async () => ({
        id: "upload-1",
        title: "Uploaded Origin",
        ownerId: "link-owner",
        sourceKind: "upload",
        originalContentType: "image/png",
        sourceContentHash: `0x${"5".repeat(64)}` as Hex,
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-06T00:00:00.000Z",
      }),
      assertLinkOriginalReadable: async () => {},
      readLinkOriginal,
      settlePayment: async () => ({
        ok: false,
        status: 402,
        reason: "invalid payment",
      }),
    });

    expect(result.status).toBe(402);
    expect(readLinkOriginal).not.toHaveBeenCalled();
  });

  it("does not settle upload links when the stored original is missing", async () => {
    const settlePayment = vi.fn();
    const result = await handleLinkDownload("upload-1", {
      ...baseDeps(paidHeaders()),
      findLink: async () => ({
        id: "upload-1",
        title: "Uploaded Origin",
        ownerId: "link-owner",
        sourceKind: "upload",
        originalContentType: "image/png",
        sourceContentHash: `0x${"5".repeat(64)}` as Hex,
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-06T00:00:00.000Z",
      }),
      assertLinkOriginalReadable: async () => {
        throw new Error("missing");
      },
      settlePayment,
    });

    expect(result.status).toBe(410);
    expect("body" in result && JSON.stringify(result.body)).toContain(
      "uploaded original is no longer available",
    );
    expect(settlePayment).not.toHaveBeenCalled();
  });
});
