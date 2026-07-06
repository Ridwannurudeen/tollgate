import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import GatedLinkPage from "./page";

const mocks = vi.hoisted(() => ({
  findLink: vi.fn(),
  readWalletForOwner: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

vi.mock("../../../lib/link-registry", () => ({
  findLink: mocks.findLink,
}));

vi.mock("../../../lib/registry", () => ({
  readWalletForOwner: mocks.readWalletForOwner,
}));

vi.mock("../../../components/SiteNav", () => ({
  SiteNav: () => "nav",
}));

vi.mock("../../../components/SiteFooter", () => ({
  SiteFooter: () => "footer",
}));

vi.mock("../../../components/LinkDownloadButton", () => ({
  LinkDownloadButton: () => "download button",
}));

describe("gated link page", () => {
  beforeEach(() => {
    mocks.findLink.mockReset();
    mocks.readWalletForOwner.mockReset();
  });

  it("renders the public photo description without exposing the source URL", async () => {
    mocks.findLink.mockResolvedValue({
      id: "link-1",
      title: "Rainy Lagos",
      description: "A night market street scene before rainfall.",
      ownerId: "owner-1",
      sourceUrl: "https://secret.example.com/original.jpg",
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
      hasPreview: true,
    });
    mocks.readWalletForOwner.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      createdAt: "2026-07-06T00:00:00.000Z",
      approvalStatus: "operator-approved",
    });

    const page = await GatedLinkPage({
      params: Promise.resolve({ id: "link-1" }),
    });
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain("Rainy Lagos");
    expect(payload).toContain("A night market street scene before rainfall.");
    expect(payload).toContain("Jane Lens");
    expect(payload).toContain("/aperture/link/link-1/preview");
    expect(payload).not.toContain("secret.example.com");
    expect(payload).not.toContain("sourceUrl");
  });
});
