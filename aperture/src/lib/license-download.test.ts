import { encodePaymentSignatureHeader } from "@x402/core/http";
import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import { LOCAL_PROOF_HEADER, handleLicenseDownload } from "./license-download";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  buildExactPaymentRequirements,
} from "./x402-server";
import type { LicensePurchaseStore } from "./license-purchase";
import type { LicenseReceipt, WalletRegistryEntry } from "./types";

const photographer: WalletRegistryEntry = {
  ownerId: "owner-1",
  displayName: "Photographer",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-06-24T00:00:00.000Z",
  approvalStatus: "operator-approved",
};

const createAuthorization = () => "authorization-token";
const purchaseStore: LicensePurchaseStore = {
  async reserve(paymentId, snapshotHash) {
    return {
      created: true,
      purchase: { paymentId, snapshotHash, state: "reserved" },
    };
  },
  async markSettled() {},
  async markReceipted() {},
  async release() {},
};

function paymentHeader(nonce = "11"): string {
  const requirements = buildExactPaymentRequirements(photographer.wallet, 2500);
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

function sharedLink() {
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
        createAuthorization,
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
        appendReceipt: async () => {
          throw new Error("unpaid request should not append");
        },
      },
    );

    expect(result.status).toBe(402);
    expect(result.headers[PAYMENT_REQUIRED_HEADER]).toBeDefined();
  });

  it("unlocks and appends a receipt after an accepted x402 payment", async () => {
    const appended: LicenseReceipt[] = [];
    const headers = new Headers({
      [PAYMENT_SIGNATURE_HEADER]: paymentHeader(),
    });
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers,
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        createAuthorization,
        purchaseStore,
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
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
    expect(appended).toHaveLength(1);
    expect(appended[0].settlementMode).toBe("x402-verified");
  });

  it("releases the reservation when x402 settlement is rejected", async () => {
    const appendReceipt = vi.fn();
    const release = vi.fn(async () => undefined);
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers: new Headers({
          [PAYMENT_SIGNATURE_HEADER]: paymentHeader(),
        }),
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        createAuthorization,
        purchaseStore: { ...purchaseStore, release },
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
        settlePayment: async () => ({
          ok: false,
          status: 402,
          reason: "payment rejected",
        }),
        appendReceipt,
      },
    );

    expect(result.status).toBe(402);
    expect(release).toHaveBeenCalledOnce();
    expect(appendReceipt).not.toHaveBeenCalled();
  });

  it("records direct-to-creator x402 settlement evidence", async () => {
    let settlementMode: LicenseReceipt["settlementMode"] | null = null;
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers: new Headers({
          [PAYMENT_SIGNATURE_HEADER]: paymentHeader(),
        }),
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        createAuthorization,
        purchaseStore,
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
        settlePayment: async () => ({
          ok: true,
          mode: "x402-verified",
          responseHeader: "settled",
        }),
        appendReceipt: async (input) => {
          settlementMode = input.evidence.settlementMode;
          return {
            receipt: fakeReceipt({
              eventId: input.eventId,
              assetId: input.assetId,
              sharedLinkId: input.sharedLinkId,
              ownerId: input.ownerId,
              photographer: input.photographer,
              amountAtomicUsdc: input.amountAtomicUsdc,
              settlementMode: input.evidence.settlementMode,
            }),
            created: true,
          };
        },
      },
    );

    expect(result.status).toBe(200);
    expect(settlementMode).toBe("x402-verified");
  });

  it("rejects an omitted asset selection that exceeds the resolved asset cap", async () => {
    const findWalletForOwner = vi.fn();
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers: new Headers(),
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        createAuthorization,
        resolveSharedLink: async () => ({
          id: "share-large",
          key: "abc123",
          type: "INDIVIDUAL",
          allowDownload: true,
          assets: Array.from({ length: 101 }, (_, index) => ({
            id: `asset-${index}`,
            ownerId: "owner-1",
            originalFileName: `${index}.jpg`,
          })),
        }),
        findWalletForOwner,
        appendReceipt: async () => {
          throw new Error("oversized selection should not append");
        },
      },
    );

    expect(result.status).toBe(400);
    expect(findWalletForOwner).not.toHaveBeenCalled();
  });

  it("supports explicit local-proof unlocks only when enabled", async () => {
    const headers = new Headers({ [LOCAL_PROOF_HEADER]: "1" });
    let settlementMode: LicenseReceipt["settlementMode"] | null = null;
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers,
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        createAuthorization,
        localProofEnabled: true,
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
        appendReceipt: async (input) => {
          settlementMode = input.evidence.settlementMode;
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
    expect(settlementMode).toBe("local-proof");
  });

  it("rejects a multi-photographer link before settlement", async () => {
    const photographerTwo: WalletRegistryEntry = {
      ownerId: "owner-2",
      displayName: "Photographer Two",
      wallet: "0x3333333333333333333333333333333333333333",
      createdAt: "2026-06-24T00:00:00.000Z",
      approvalStatus: "operator-approved",
    };
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers: new Headers({
          [PAYMENT_SIGNATURE_HEADER]: paymentHeader(),
        }),
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        createAuthorization,
        resolveSharedLink: async () => ({
          id: "share-1",
          key: "abc123",
          type: "INDIVIDUAL",
          allowDownload: true,
          assets: [
            { id: "asset-1", ownerId: "owner-1", originalFileName: "a.png" },
            { id: "asset-2", ownerId: "owner-2", originalFileName: "b.png" },
          ],
        }),
        findWalletForOwner: async (ownerId) =>
          ownerId === "owner-2" ? photographerTwo : photographer,
        appendReceipt: async () => {
          throw new Error("multi-owner without collector should not append");
        },
      },
    );

    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).toContain("multi-photographer");
  });

  it("rejects a partial selection before authorization", async () => {
    const appended: string[] = [];
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123", assetIds: ["asset-1"] },
      {
        headers: new Headers({ [LOCAL_PROOF_HEADER]: "1" }),
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        createAuthorization,
        localProofEnabled: true,
        resolveSharedLink: async () => ({
          id: "share-1",
          key: "abc123",
          type: "INDIVIDUAL",
          allowDownload: true,
          assets: [
            { id: "asset-1", ownerId: "owner-1", originalFileName: "a.png" },
            { id: "asset-2", ownerId: "owner-1", originalFileName: "b.png" },
          ],
        }),
        findWalletForOwner: async () => photographer,
        appendReceipt: async (input) => {
          appended.push(input.assetId);
          return {
            receipt: fakeReceipt({
              eventId: input.eventId,
              assetId: input.assetId,
              sharedLinkId: input.sharedLinkId,
              ownerId: input.ownerId,
              photographer: input.photographer,
              amountAtomicUsdc: input.amountAtomicUsdc,
              settlementMode: input.evidence.settlementMode,
            }),
            created: true,
          };
        },
      },
    );

    expect(result.status).toBe(400);
    expect(appended).toEqual([]);
  });

  it("fails before settlement when download authorization is unavailable", async () => {
    const settlePayment = vi.fn();
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      {
        headers: new Headers({
          [PAYMENT_SIGNATURE_HEADER]: paymentHeader(),
        }),
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        createAuthorization: () => null,
        resolveSharedLink: async () => sharedLink(),
        findWalletForOwner: async () => photographer,
        settlePayment,
        appendReceipt: async () => {
          throw new Error("authorization failure must not append");
        },
      },
    );

    expect(result.status).toBe(503);
    expect(settlePayment).not.toHaveBeenCalled();
  });
});
