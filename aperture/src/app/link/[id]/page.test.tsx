import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import GatedLinkPage from "./page";

const mocks = vi.hoisted(() => ({
  findLink: vi.fn(),
  readWalletForOwner: vi.fn(),
  getSessionOwner: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
}));

vi.mock("../../../lib/link-registry", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/link-registry")
  >("../../../lib/link-registry");
  return {
    ...actual,
    findLink: mocks.findLink,
  };
});

vi.mock("../../../lib/registry", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/registry")>(
    "../../../lib/registry",
  );
  return {
    ...actual,
    readWalletForOwner: mocks.readWalletForOwner,
  };
});

vi.mock("../../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
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

vi.mock("../../../components/LinkMessagePanel", () => ({
  LinkMessagePanel: ({ linkId }: { linkId: string }) =>
    `message panel:${linkId}`,
}));

describe("gated link page", () => {
  beforeEach(() => {
    mocks.findLink.mockReset();
    mocks.readWalletForOwner.mockReset();
    mocks.getSessionOwner.mockReset();
    mocks.getSessionOwner.mockResolvedValue(null);
  });

  it("renders the public photo description without exposing the source URL", async () => {
    mocks.findLink.mockResolvedValue({
      id: "link-1",
      title: "Rainy Lagos archive@example.com",
      description:
        "A night market street scene from archive@example.com before rainfall.",
      ownerId: "owner-1",
      sourceUrl: "https://secret.example.com/original.jpg",
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
      hasPreview: true,
    });
    mocks.readWalletForOwner.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens archive@example.com",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      createdAt: "2026-07-06T00:00:00.000Z",
      approvalStatus: "operator-approved",
    });

    const page = await GatedLinkPage({
      params: Promise.resolve({ id: "link-1" }),
    });
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain("Rainy Lagos");
    expect(payload).toContain("A night market street scene");
    expect(payload).toContain("Jane Lens");
    expect(payload).not.toContain("archive@example.com");
    expect(payload).toContain("/aperture/link/link-1/preview");
    expect(payload).not.toContain("secret.example.com");
    expect(payload).not.toContain("sourceUrl");
    expect(payload).not.toContain("message panel:");
  });

  it("renders video-specific preview copy without exposing original metadata", async () => {
    mocks.findLink.mockResolvedValue({
      id: "video-1",
      title: "Rainy Lagos Clip",
      description: "A short licensed street-market clip.",
      ownerId: "owner-1",
      mediaKind: "video",
      sourceKind: "upload",
      originalContentType: "video/mp4",
      sourceContentHash: `0x${"b".repeat(64)}`,
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
      params: Promise.resolve({ id: "video-1" }),
    });
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain("Aperture gated video");
    expect(payload).toContain("Rainy Lagos Clip");
    expect(payload).toContain("A short licensed street-market clip.");
    expect(payload).toContain("Watermarked thumbnail preview");
    expect(payload).toContain("/aperture/link/video-1/preview");
    expect(payload).toContain("mediaBadge");
    expect(payload).not.toContain("video/mp4");
    expect(payload).not.toContain("sourceContentHash");
  });

  it("shows the message panel only to logged-in non-sellers", async () => {
    mocks.findLink.mockResolvedValue({
      id: "link-1",
      title: "Rainy Lagos",
      ownerId: "owner-1",
      sourceUrl: "https://secret.example.com/original.jpg",
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
    });
    mocks.readWalletForOwner.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      createdAt: "2026-07-06T00:00:00.000Z",
      approvalStatus: "operator-approved",
    });
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "buyer-1",
      displayName: "Buyer",
    });

    const page = await GatedLinkPage({
      params: Promise.resolve({ id: "link-1" }),
    });
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain("message panel:link-1");
  });
});
