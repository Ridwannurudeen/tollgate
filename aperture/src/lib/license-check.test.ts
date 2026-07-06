import { describe, expect, it } from "vitest";
import { evaluateLicenseCheck } from "./license-check";
import type {
  ImmichSharedLink,
  LicenseLedger,
  LicenseReceipt,
  WalletRegistryEntry,
} from "./types";

const approvedPhotographer: WalletRegistryEntry = {
  ownerId: "owner-1",
  displayName: "Photographer",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-06-24T00:00:00.000Z",
  approvalStatus: "operator-approved",
};

function sharedLink(assets: ImmichSharedLink["assets"]): ImmichSharedLink {
  return {
    id: "share-1",
    key: "abc123",
    assets,
  };
}

function receipt(assetId: string): LicenseReceipt {
  return {
    id: `receipt-${assetId}`,
    eventId: `0x${"1".repeat(64)}`,
    assetId,
    sharedLinkId: "share-1",
    sharedLinkKeyHash: `0x${"2".repeat(64)}`,
    ownerId: "owner-1",
    photographer: "Photographer",
    wallet: approvedPhotographer.wallet,
    amountAtomicUsdc: 2_500,
    settlementMode: "forum-routed",
    paymentResource: "forum-fee-router",
    rawAccessLogHash: `0x${"3".repeat(64)}`,
    previousHash: `0x${"0".repeat(64)}`,
    receiptHash: `0x${"4".repeat(64)}`,
    createdAt: "2026-06-27T12:00:00.000Z",
  };
}

describe("evaluateLicenseCheck", () => {
  it("allows owner-session archive downloads without a shared-link key", async () => {
    let resolveCalls = 0;
    const result = await evaluateLicenseCheck(
      { originalUri: "/immich/api/download/archive" },
      {
        resolveSharedLink: async () => {
          resolveCalls += 1;
          throw new Error("owner download should not resolve");
        },
      },
    );

    expect(result).toEqual({ allowed: true, status: 204 });
    expect(resolveCalls).toBe(0);
  });

  it("denies when the shared-link key cannot be resolved", async () => {
    const result = await evaluateLicenseCheck(
      { originalUri: "/immich/api/download/archive?key=bad" },
      {
        resolveSharedLink: async () => {
          throw new Error("missing");
        },
      },
    );

    expect(result).toMatchObject({
      allowed: false,
      status: 403,
      body: { error: "payment required" },
    });
  });

  it("allows when every payable asset already has a license receipt", async () => {
    const ledger: LicenseLedger = { receipts: [receipt("asset-1")] };
    let ledgerReads = 0;
    let resolveCalls = 0;
    const result = await evaluateLicenseCheck(
      { originalUri: "/immich/api/download/archive?key=abc123" },
      {
        resolveSharedLink: async () => {
          resolveCalls += 1;
          return sharedLink([
            {
              id: "asset-1",
              ownerId: "owner-1",
              originalFileName: "photo.png",
            },
          ]);
        },
        readWalletForOwner: async () => approvedPhotographer,
        readLicenseLedger: async () => {
          ledgerReads += 1;
          return ledger;
        },
      },
    );

    expect(result).toEqual({ allowed: true, status: 204 });
    expect(resolveCalls).toBe(1);
    expect(ledgerReads).toBe(1);
  });

  it("denies when one payable asset is missing a license receipt", async () => {
    const ledger: LicenseLedger = { receipts: [receipt("asset-1")] };
    const result = await evaluateLicenseCheck(
      { originalUri: "/immich/api/download/archive?key=abc123" },
      {
        resolveSharedLink: async () =>
          sharedLink([
            {
              id: "asset-1",
              ownerId: "owner-1",
              originalFileName: "photo-a.png",
            },
            {
              id: "asset-2",
              ownerId: "owner-1",
              originalFileName: "photo-b.png",
            },
          ]),
        readWalletForOwner: async () => approvedPhotographer,
        readLicenseLedger: async () => ledger,
      },
    );

    expect(result).toMatchObject({ allowed: false, status: 403 });
  });

  it("ignores unregistered owner assets", async () => {
    const result = await evaluateLicenseCheck(
      { originalUri: "/immich/api/download/archive?key=abc123" },
      {
        resolveSharedLink: async () =>
          sharedLink([
            {
              id: "asset-1",
              ownerId: "owner-unregistered",
              originalFileName: "photo.png",
            },
          ]),
        readWalletForOwner: async () => null,
        readLicenseLedger: async () => ({ receipts: [] }),
      },
    );

    expect(result).toEqual({ allowed: true, status: 204 });
  });

  it("treats pending-approval owners as unregistered", async () => {
    const result = await evaluateLicenseCheck(
      { originalUri: "/immich/api/download/archive?key=abc123" },
      {
        resolveSharedLink: async () =>
          sharedLink([
            {
              id: "asset-1",
              ownerId: "owner-1",
              originalFileName: "photo.png",
            },
          ]),
        readWalletForOwner: async () => ({
          ...approvedPhotographer,
          approvalStatus: "pending",
        }),
        readLicenseLedger: async () => ({ receipts: [] }),
      },
    );

    expect(result).toEqual({ allowed: true, status: 204 });
  });
});
