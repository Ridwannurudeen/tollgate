import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import DashboardPage from "./page";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  readLinksByOwner: vi.fn(),
  readLicenseLedger: vi.fn(),
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

describe("dashboard page", () => {
  beforeEach(() => {
    mocks.getSessionOwner.mockReset();
    mocks.readLinksByOwner.mockReset();
    mocks.readLicenseLedger.mockReset();
    mocks.redirect.mockReset();
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`redirect:${path}`);
    });
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
      accountKeyHash: `0x${"a".repeat(64)}`,
      email: "jane@example.com",
      loginTokenHash: `0x${"c".repeat(64)}`,
      loginTokenExpiresAt: "2026-07-06T00:20:00.000Z",
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

    const page = await DashboardPage();
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain("Private Source Photo");
    expect(payload).toContain("j***@example.com");
    expect(payload).toContain("0.0025");
    expect(payload).not.toContain("secret.example.com");
    expect(payload).not.toContain("sourceContentHash");
    expect(payload).not.toContain("accountKeyHash");
    expect(payload).not.toContain("jane@example.com");
    expect(payload).not.toContain("loginTokenHash");
    expect(payload).not.toContain("loginTokenExpiresAt");
    expect(payload).not.toContain("0.0090");
  });
});
