import React, { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProofPage from "./page";

vi.stubGlobal("React", React);

const mocks = vi.hoisted(() => ({
  readLicenseLedger: vi.fn(),
  readWalletRegistry: vi.fn(),
  summarizeLedger: vi.fn(),
  verifyLicenseLedger: vi.fn(),
}));

vi.mock("../../lib/ledger", () => ({
  readLicenseLedger: mocks.readLicenseLedger,
  summarizeLedger: mocks.summarizeLedger,
  verifyLicenseLedger: mocks.verifyLicenseLedger,
}));

vi.mock("../../lib/registry", () => ({
  readWalletRegistry: mocks.readWalletRegistry,
}));

vi.mock("../../components/SiteNav", () => ({
  SiteNav: () => "nav",
}));

vi.mock("../../components/SiteFooter", () => ({
  SiteFooter: () => "footer",
}));

describe("proof page", () => {
  beforeEach(() => {
    mocks.readLicenseLedger.mockReset();
    mocks.readWalletRegistry.mockReset();
    mocks.summarizeLedger.mockReset();
    mocks.verifyLicenseLedger.mockReset();
  });

  it("redacts historical receipt and creator text without replacing receipt hashes", async () => {
    const receiptHash = `0x${"4".repeat(64)}`;
    mocks.readLicenseLedger.mockResolvedValue({
      receipts: [
        {
          id: "receipt-1",
          assetId: "asset-1",
          photographer: "archive@example.com",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          amountAtomicUsdc: 2500,
          settlementMode: "local-proof",
          paymentResource: "http://127.0.0.1:2283/api/assets/private",
          exifArtist: "archive@example.com",
          exifSourcePath: "C:\\Immich\\library\\private\\photo.jpg",
          receiptHash,
        },
      ],
    });
    mocks.readWalletRegistry.mockResolvedValue({ photographers: [] });
    mocks.summarizeLedger.mockReturnValue([
      {
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        photographer: "archive@example.com",
        resolves: 1,
        earned: 2500,
      },
    ]);
    mocks.verifyLicenseLedger.mockReturnValue({
      ok: true,
      receiptCount: 1,
      latestHash: receiptHash,
      issues: [],
    });

    const page = await ProofPage();
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain(receiptHash.slice(0, 18));
    expect(payload).not.toContain("archive@example.com");
    expect(payload).not.toContain("127.0.0.1");
    expect(payload).not.toContain("Immich");
  });
});
