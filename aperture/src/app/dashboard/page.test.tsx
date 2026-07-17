import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React, { type ReactElement } from "react";
import DashboardPage from "./page";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  readLinksByOwner: vi.fn(),
  readLicenseLedger: vi.fn(),
  fetchCitationsSummary: vi.fn(),
  readCustodialUsdcBalance: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
  maskAccountEmail: (email: string) => email.replace(/^(.).+@/, "$1***@"),
}));

vi.mock("../../components/SiteNav", () => ({
  SiteNav: () => "nav",
}));

vi.mock("../../components/SiteFooter", () => ({
  SiteFooter: () => "footer",
}));

vi.mock("../../components/LinkedWalletsForm", () => ({
  LinkedWalletsForm: ({ linkedWallets }: { linkedWallets: string[] }) => (
    <div>linked:{linkedWallets.join(",")}</div>
  ),
}));

vi.mock("../../components/DashboardMessages", () => ({
  DashboardMessages: ({ ownerId }: { ownerId: string }) => (
    <div>messages:{ownerId}</div>
  ),
}));

vi.mock("../../components/WithdrawForm", () => ({
  WithdrawForm: ({
    initialBalanceAtomicUsdc,
    wallet,
  }: {
    initialBalanceAtomicUsdc: string | null;
    wallet: string;
  }) => <div>withdraw:{wallet}:{initialBalanceAtomicUsdc}</div>,
}));

vi.mock("../../lib/citations-summary", () => ({
  fetchCitationsSummary: mocks.fetchCitationsSummary,
}));

vi.mock("../../lib/ledger", () => ({
  readLicenseLedger: mocks.readLicenseLedger,
}));

vi.mock("../../lib/link-registry", async () => {
  const actual = await vi.importActual<
    typeof import("../../lib/link-registry")
  >("../../lib/link-registry");
  return {
    ...actual,
    readLinksByOwner: mocks.readLinksByOwner,
  };
});

vi.mock("../../lib/withdraw", () => ({
  readCustodialUsdcBalance: mocks.readCustodialUsdcBalance,
}));

describe("dashboard page", () => {
  beforeEach(() => {
    mocks.getSessionOwner.mockReset();
    mocks.readLinksByOwner.mockReset();
    mocks.readLicenseLedger.mockReset();
    mocks.fetchCitationsSummary.mockReset();
    mocks.readCustodialUsdcBalance.mockReset();
    mocks.redirect.mockReset();
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
    mocks.fetchCitationsSummary.mockResolvedValue({
      wallet: "0x12f25b721cc21c38495e33a4c8524dd0b647ba03",
      earnings: {
        sourceCount: 0,
        citationCount: 0,
        earnedAtomicUsdc: 0,
      },
      sources: [],
    });
    mocks.readCustodialUsdcBalance.mockResolvedValue(2500n);
  });

  it("redirects to login without a session", async () => {
    mocks.getSessionOwner.mockResolvedValue(null);

    await expect(DashboardPage()).rejects.toThrow("redirect:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("renders only public work fields for the session owner", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      approvalStatus: "operator-approved",
      custody: "circle-w3s",
      walletId: "circle-wallet-id",
      accountKeyHash: `0x${"a".repeat(64)}`,
      email: "jane@example.com",
      loginTokenHash: `0x${"c".repeat(64)}`,
      loginTokenExpiresAt: "2026-07-06T00:20:00.000Z",
      linkedWallets: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });
    mocks.readLinksByOwner.mockResolvedValue([
      {
        id: "link-1",
        title: "Private Source Photo",
        ownerId: "owner-1",
        sourceUrl: "https://secret.example.com/photo.jpg",
        sourceContentHash: `0x${"b".repeat(64)}`,
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-06T00:00:00.000Z",
      },
      {
        id: "video-1",
        title: "Private Source Clip",
        ownerId: "owner-1",
        mediaKind: "video",
        sourceKind: "upload",
        originalContentType: "video/mp4",
        sourceContentHash: `0x${"d".repeat(64)}`,
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-07T00:00:00.000Z",
        hasPreview: true,
      },
    ]);
    mocks.readLicenseLedger.mockResolvedValue({
      receipts: [
        {
          ownerId: "owner-1",
          amountAtomicUsdc: 2500,
        },
        {
          ownerId: "owner-2",
          amountAtomicUsdc: 9000,
        },
      ],
    });
    mocks.fetchCitationsSummary.mockImplementation(async (wallet: string) => {
      if (wallet === "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
        return {
          wallet,
          earnings: {
            sourceCount: 1,
            citationCount: 2,
            earnedAtomicUsdc: 3000,
          },
          sources: [
            {
              id: "citation-source",
              title: "Citation Source",
              creator: "Jane Writer",
              handle: "@jane",
              wallet,
              url: "https://source.example",
              summary: "Source summary",
              tags: ["ai"],
              priceAtomicUsdc: 1200,
              sourceKind: "external",
              creatorKind: "external",
              verifiedCreator: true,
              citationCount: 2,
              earnedAtomicUsdc: 3000,
              notifyEmail: "writer@example.com",
            },
          ],
        };
      }
      return {
        wallet,
        earnings: {
          sourceCount: 0,
          citationCount: 0,
          earnedAtomicUsdc: 0,
        },
        sources: [],
      };
    });

    const page = await DashboardPage();
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain("Your Tollgate creator dashboard");
    expect(payload).toContain("Private Source Photo");
    expect(payload).toContain("Private Source Clip");
    expect(payload).toContain("video / preview ready");
    expect(payload).toContain("/aperture/link/video-1/preview");
    expect(payload).toContain("Citation Source");
    expect(payload).toContain(
      "Video payouts settle through the PeerTube plugin",
    );
    expect(payload).toContain("https://tollgate.gudman.xyz/video");
    expect(payload).toContain(
      "linked:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(payload).toContain("j***@example.com");
    expect(payload).toContain("Withdraw custodial balance");
    expect(payload).toContain(
      "withdraw:0x12F25B721Cc21c38495e33A4c8524dd0B647ba03:2500",
    );
    expect(payload).toContain("messages:owner-1");
    expect(payload).not.toContain("add-email:");
    expect(payload).toContain("0.0025");
    expect(payload).toContain("0.0030");
    expect(payload).toContain("0.0055");
    expect(mocks.fetchCitationsSummary).toHaveBeenCalledWith(
      "0x12f25b721cc21c38495e33a4c8524dd0b647ba03",
    );
    expect(mocks.fetchCitationsSummary).toHaveBeenCalledWith(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(payload).not.toContain("secret.example.com");
    expect(payload).not.toContain("video/mp4");
    expect(payload).not.toContain("sourceContentHash");
    expect(payload).not.toContain("accountKeyHash");
    expect(payload).not.toContain("jane@example.com");
    expect(payload).not.toContain("loginTokenHash");
    expect(payload).not.toContain("loginTokenExpiresAt");
    expect(payload).not.toContain("writer@example.com");
    expect(payload).not.toContain("notifyEmail");
    expect(payload).not.toContain("0.0090");
  });

  it("still renders when citations summaries are unavailable", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      approvalStatus: "operator-approved",
    });
    mocks.readLinksByOwner.mockResolvedValue([]);
    mocks.readLicenseLedger.mockResolvedValue({ receipts: [] });
    mocks.fetchCitationsSummary.mockResolvedValue(null);

    const page = await DashboardPage();
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain(
      "Couldn&#x27;t load citations earnings right now",
    );
    expect(payload).toContain("Account key only");
    expect(payload).toContain("Open video proof");
  });
});
