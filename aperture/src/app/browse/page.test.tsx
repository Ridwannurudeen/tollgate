import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import BrowsePage from "./page";

const mocks = vi.hoisted(() => ({
  listPublicLinks: vi.fn(),
  readWalletRegistry: vi.fn(),
}));

vi.mock("../../lib/link-registry", () => ({
  listPublicLinks: mocks.listPublicLinks,
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

describe("browse page", () => {
  beforeEach(() => {
    mocks.listPublicLinks.mockReset();
    mocks.readWalletRegistry.mockReset();
  });

  it("renders public registered works without source URLs or account hashes", async () => {
    mocks.listPublicLinks.mockResolvedValue([
      {
        id: "link-1",
        title: "Catalog Photo",
        description: "A watermarked catalog preview with buyer context.",
        ownerId: "owner-1",
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-06T00:00:00.000Z",
        hasPreview: true,
      },
      {
        id: "video-1",
        title: "Catalog Clip",
        description: "A short licensed clip with a watermarked thumbnail.",
        mediaKind: "video",
        ownerId: "owner-1",
        priceAtomicUsdc: 2500,
        createdAt: "2026-07-07T00:00:00.000Z",
        hasPreview: true,
      },
    ]);
    mocks.readWalletRegistry.mockResolvedValue({
      photographers: [
        {
          ownerId: "owner-1",
          displayName: "Jane Lens",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          createdAt: "2026-07-06T00:00:00.000Z",
          approvalStatus: "operator-approved",
          accountKeyHash: `0x${"a".repeat(64)}`,
          email: "jane@example.com",
          loginTokenHash: `0x${"b".repeat(64)}`,
          loginTokenExpiresAt: "2026-07-06T00:20:00.000Z",
        },
      ],
    });

    const page = await BrowsePage();
    const payload = renderToStaticMarkup(page as ReactElement);

    expect(payload).toContain("Catalog Photo");
    expect(payload).toContain("Catalog Clip");
    expect(payload).toContain(
      "A watermarked catalog preview with buyer context.",
    );
    expect(payload).toContain(
      "A short licensed clip with a watermarked thumbnail.",
    );
    expect(payload).toContain("photo and video licenses");
    expect(payload).toContain("Jane Lens");
    expect(payload).toContain("/aperture/link/link-1/preview");
    expect(payload).toContain("/aperture/link/video-1/preview");
    expect(payload).toContain("mediaBadge");
    expect(payload).toContain(">video<");
    expect(payload).not.toContain("accountKeyHash");
    expect(payload).not.toContain("jane@example.com");
    expect(payload).not.toContain("loginTokenHash");
    expect(payload).not.toContain("loginTokenExpiresAt");
    expect(payload).not.toContain("sourceUrl");
  });
});
