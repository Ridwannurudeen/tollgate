import { encodePaymentSignatureHeader } from "@x402/core/http";
import { describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";
import {
  PAYMENT_SIGNATURE_HEADER,
  buildExactPaymentRequirements,
  type X402Settlement,
} from "./x402-server";
import {
  handleLicenseDownload,
  type LicenseDownloadDeps,
} from "./license-download";
import type {
  LicensePurchase,
  LicensePurchaseStore,
} from "./license-purchase";
import type { LicenseReceipt, WalletRegistryEntry } from "./types";

const photographer: WalletRegistryEntry = {
  ownerId: "owner-1",
  displayName: "Photographer",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-06-24T00:00:00.000Z",
  approvalStatus: "operator-approved",
};

function settled(): X402Settlement {
  return {
    ok: true,
    mode: "x402-settled",
    payer: "0x2222222222222222222222222222222222222222",
    transaction: `0x${"3".repeat(64)}`,
    responseHeader: "settled",
  };
}

function paymentHeader(nonce: string, amountAtomicUsdc = 2500): string {
  const requirements = buildExactPaymentRequirements(
    photographer.wallet,
    amountAtomicUsdc,
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

function receipt(eventId: Hex, assetId: string): LicenseReceipt {
  return {
    id: eventId.slice(0, 18),
    eventId,
    assetId,
    sharedLinkId: "share-1",
    sharedLinkKeyHash: `0x${"1".repeat(64)}`,
    ownerId: "owner-1",
    photographer: photographer.displayName,
    wallet: photographer.wallet,
    amountAtomicUsdc: 2500,
    settlementMode: "x402-settled",
    paymentResource: "x402-license-download:share-1",
    rawAccessLogHash: `0x${"2".repeat(64)}`,
    previousHash: `0x${"0".repeat(64)}`,
    receiptHash: `0x${"4".repeat(64)}`,
    createdAt: "2026-06-27T12:01:00.000Z",
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
      settlementEvidence,
      authorizationExpiresAt,
    ) {
      purchases.set(paymentId, {
        paymentId,
        snapshotHash,
        state: "settled",
        settlement: settlementEvidence,
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

function baseDeps(
  overrides: Partial<LicenseDownloadDeps> & {
    purchaseStore?: LicensePurchaseStore;
  } = {},
): LicenseDownloadDeps {
  return {
    headers: new Headers({
      [PAYMENT_SIGNATURE_HEADER]: paymentHeader("11"),
    }),
    origin: "https://tollgate.gudman.xyz",
    basePath: "/aperture",
    createAuthorization: () => "authorization-token",
    resolveSharedLink: async () => ({
      id: "share-1",
      key: "abc123",
      type: "INDIVIDUAL",
      allowDownload: true,
      assets: [
        {
          id: "asset-1",
          ownerId: "owner-1",
          originalFileName: "photo.png",
        },
      ],
    }),
    findWalletForOwner: async () => photographer,
    settlePayment: async () => settled(),
    appendReceipt: async (input) => ({
      receipt: receipt(input.eventId, input.assetId),
      created: true,
    }),
    now: () => "2026-06-27T12:01:00.000Z",
    purchaseStore: memoryPurchaseStore(),
    ...overrides,
  } as LicenseDownloadDeps;
}

describe("license download payment integrity", () => {
  it("rejects a view-only link before offering or settling payment", async () => {
    const settlePayment = vi.fn(async () => settled());
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      baseDeps({
        settlePayment,
        resolveSharedLink: async () => ({
          id: "share-1",
          key: "abc123",
          type: "INDIVIDUAL",
          allowDownload: false,
          assets: [
            {
              id: "asset-1",
              ownerId: "owner-1",
              originalFileName: "photo.png",
            },
          ],
        }),
      }),
    );

    expect(result.status).toBe(403);
    expect(settlePayment).not.toHaveBeenCalled();
  });

  it("rejects the whole archive when any asset lacks an approved wallet", async () => {
    const settlePayment = vi.fn(async () => settled());
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      baseDeps({
        settlePayment,
        resolveSharedLink: async () => ({
          id: "share-1",
          key: "abc123",
          type: "INDIVIDUAL",
          allowDownload: true,
          assets: [
            {
              id: "asset-1",
              ownerId: "owner-1",
              originalFileName: "a.png",
            },
            {
              id: "asset-2",
              ownerId: "owner-2",
              originalFileName: "b.png",
            },
          ],
        }),
        findWalletForOwner: async (ownerId) =>
          ownerId === "owner-1" ? photographer : null,
      }),
    );

    expect(result.status).toBe(409);
    expect(settlePayment).not.toHaveBeenCalled();
  });

  it("charges every asset from one photographer without a collector", async () => {
    const appended: string[] = [];
    const result = await handleLicenseDownload(
      { sharedLinkKey: "abc123", assetIds: ["asset-1", "asset-2"] },
      baseDeps({
        headers: new Headers({
          [PAYMENT_SIGNATURE_HEADER]: paymentHeader("33", 5000),
        }),
        resolveSharedLink: async () => ({
          id: "share-1",
          key: "abc123",
          type: "INDIVIDUAL",
          allowDownload: true,
          assets: [
            {
              id: "asset-1",
              ownerId: "owner-1",
              originalFileName: "a.png",
            },
            {
              id: "asset-2",
              ownerId: "owner-1",
              originalFileName: "b.png",
            },
          ],
        }),
        appendReceipt: async (input) => {
          appended.push(input.assetId);
          return {
            receipt: receipt(input.eventId, input.assetId),
            created: true,
          };
        },
      }),
    );

    expect(result.status).toBe(200);
    expect(appended).toEqual(["asset-1", "asset-2"]);
  });

  it("uses the payment identity so separate buyers never share a receipt", async () => {
    const stored = new Map<Hex, LicenseReceipt>();
    const appendReceipt = vi.fn(async (input) => {
      const created = receipt(input.eventId, input.assetId);
      stored.set(input.eventId, created);
      return { receipt: created, created: true };
    });
    const purchaseStore = memoryPurchaseStore();

    const first = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      baseDeps({ appendReceipt, purchaseStore }),
    );
    const second = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      baseDeps({
        appendReceipt,
        purchaseStore,
        headers: new Headers({
          [PAYMENT_SIGNATURE_HEADER]: paymentHeader("22"),
        }),
      }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(stored).toHaveLength(2);
    expect(new Set([...stored.keys()])).toHaveLength(2);
  });

  it("returns access and resumes receipt persistence without settling twice", async () => {
    const settlePayment = vi.fn(async () => settled());
    const purchaseStore = memoryPurchaseStore();
    const appendReceipt = vi
      .fn()
      .mockRejectedValueOnce(new Error("ledger unavailable"))
      .mockImplementationOnce(async (input) => ({
        receipt: receipt(input.eventId, input.assetId),
        created: true,
      }));
    const deps = baseDeps({
      appendReceipt,
      purchaseStore,
      settlePayment,
    });

    const first = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      deps,
    );
    const retried = await handleLicenseDownload(
      { sharedLinkKey: "abc123" },
      deps,
    );

    expect(first).toMatchObject({
      status: 200,
      body: { unlocked: true, receiptStatus: "pending" },
    });
    expect(retried.status).toBe(200);
    expect(settlePayment).toHaveBeenCalledTimes(1);
    expect(appendReceipt).toHaveBeenCalledTimes(2);
  });
});
