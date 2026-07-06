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
          accountKeyHash: `0x${"a".repeat(64)}`,
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
    expect(payload).not.toContain("accountKeyHash");
    expect(payload).not.toContain("ownershipProof");
    expect(payload).not.toContain("signatureHash");
  });
});
