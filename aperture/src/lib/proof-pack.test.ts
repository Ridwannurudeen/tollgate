import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProofPack } from "./proof-pack";

const mocks = vi.hoisted(() => ({
  readLicenseLedger: vi.fn(),
  summarizeLedger: vi.fn(),
  verifyLicenseLedger: vi.fn(),
  readWalletRegistry: vi.fn(),
  readFeeRouterSplitRegistry: vi.fn(),
}));

vi.mock("./ledger", () => ({
  readLicenseLedger: mocks.readLicenseLedger,
  summarizeLedger: mocks.summarizeLedger,
  verifyLicenseLedger: mocks.verifyLicenseLedger,
}));

vi.mock("./registry", () => ({
  publicWalletRegistryEntry: (entry: Record<string, unknown>) => ({
    ownerId: String(entry.ownerId).replace(
      /[^\s@]+@[^\s@]+\.[^\s@]+/g,
      "[redacted-email]",
    ),
    displayName: String(entry.displayName).replace(
      /[^\s@]+@[^\s@]+\.[^\s@]+/g,
      "[redacted-email]",
    ),
    wallet: entry.wallet,
    createdAt: entry.createdAt,
    approvalStatus: entry.approvalStatus,
    custody: entry.custody,
  }),
  readWalletRegistry: mocks.readWalletRegistry,
}));

vi.mock("./fee-router", () => ({
  readFeeRouterSplitRegistry: mocks.readFeeRouterSplitRegistry,
}));

describe("buildProofPack", () => {
  beforeEach(() => {
    mocks.readLicenseLedger.mockResolvedValue({ receipts: [] });
    mocks.summarizeLedger.mockReturnValue([]);
    mocks.verifyLicenseLedger.mockReturnValue({
      ok: true,
      receiptCount: 0,
      latestHash: `0x${"0".repeat(64)}`,
      issues: [],
    });
    mocks.readFeeRouterSplitRegistry.mockResolvedValue([]);
    mocks.readWalletRegistry.mockResolvedValue({
      photographers: [
        {
          ownerId: "owner-1",
          displayName: "Jane Lens",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          createdAt: "2026-07-06T00:00:00.000Z",
          approvalStatus: "operator-approved",
          walletId: "circle-wallet-id",
          email: "jane@example.com",
          accountKeyHash: `0x${"a".repeat(64)}`,
          loginTokenHash: `0x${"c".repeat(64)}`,
          loginTokenExpiresAt: "2026-07-06T00:20:00.000Z",
          linkedWallets: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          ownershipProof: {
            method: "wallet-signature",
            signer: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
            signatureHash: `0x${"b".repeat(64)}`,
            verifiedAt: "2026-07-06T00:00:00.000Z",
          },
        },
      ],
    });
  });

  it("strips private registry fields from the public proof pack", async () => {
    const pack = await buildProofPack();
    const payload = JSON.stringify(pack.registry);

    expect(payload).toContain("Jane Lens");
    expect(payload).not.toContain("circle-wallet-id");
    expect(payload).not.toContain("jane@example.com");
    expect(payload).not.toContain("accountKeyHash");
    expect(payload).not.toContain("loginTokenHash");
    expect(payload).not.toContain("loginTokenExpiresAt");
    expect(payload).not.toContain("linkedWallets");
    expect(payload).not.toContain("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(payload).not.toContain("ownershipProof");
    expect(payload).not.toContain("signatureHash");
  });

  it("redacts historical PII and host paths while preserving receipt hashes", async () => {
    const receipt = {
      id: "receipt-1",
      photographer: "archive@example.com",
      exifArtist: "archive@example.com",
      exifCopyright: "Copyright archive@example.com",
      exifSourcePath: "C:\\Immich\\library\\private\\photo.jpg",
      paymentResource: "http://127.0.0.1:2283/api/assets/private",
      previousHash: `0x${"0".repeat(64)}`,
      receiptHash: `0x${"4".repeat(64)}`,
    };
    mocks.readLicenseLedger.mockResolvedValueOnce({ receipts: [receipt] });
    mocks.summarizeLedger.mockReturnValueOnce([
      {
        photographer: "archive@example.com",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        resolves: 1,
        earned: 2500,
      },
    ]);
    mocks.readWalletRegistry.mockResolvedValueOnce({
      photographers: [
        {
          ownerId: "owner-1",
          displayName: "Archive archive@example.com",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          createdAt: "2026-07-06T00:00:00.000Z",
          approvalStatus: "operator-approved",
        },
      ],
    });

    const pack = await buildProofPack();
    const payload = JSON.stringify(pack);

    expect(payload).not.toContain("archive@example.com");
    expect(payload).not.toContain("C:\\\\Immich\\\\library");
    expect(payload).not.toContain("127.0.0.1");
    expect(payload).not.toContain("immichApiBaseUrl");
    expect(pack.ledger.receipts[0].receiptHash).toBe(receipt.receiptHash);
    expect(receipt.exifSourcePath).toBe(
      "C:\\Immich\\library\\private\\photo.jpg",
    );
  });

  it("keeps the checked-in proof export free of internal endpoints", async () => {
    const exported = await readFile(
      new URL("../../data/proof-pack.json", import.meta.url),
      "utf8",
    );

    expect(exported).not.toContain("immichApiBaseUrl");
    expect(exported).not.toContain("127.0.0.1");
  });
});
