import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  findLink: vi.fn(),
  readLinkPreview: vi.fn(),
}));

vi.mock("../../../../lib/link-registry", () => ({
  findLink: mocks.findLink,
}));

vi.mock("../../../../lib/link-preview", () => ({
  readLinkPreview: mocks.readLinkPreview,
}));

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /link/[id]/preview", () => {
  beforeEach(() => {
    mocks.findLink.mockReset();
    mocks.readLinkPreview.mockReset();
  });

  it("returns 404 when the link is missing", async () => {
    mocks.findLink.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("http://aperture.test"),
      context("x"),
    );

    expect(response.status).toBe(404);
    expect(mocks.readLinkPreview).not.toHaveBeenCalled();
  });

  it("returns 404 when the link has no generated preview", async () => {
    mocks.findLink.mockResolvedValueOnce({
      id: "link-1",
      title: "Photo",
      ownerId: "owner",
      sourceUrl: "https://photos.example.com/photo.jpg",
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
    });

    const response = await GET(
      new Request("http://aperture.test"),
      context("link-1"),
    );

    expect(response.status).toBe(404);
    expect(mocks.readLinkPreview).not.toHaveBeenCalled();
  });

  it("serves the watermarked webp preview", async () => {
    mocks.findLink.mockResolvedValueOnce({
      id: "link-1",
      title: "Photo",
      ownerId: "owner",
      sourceUrl: "https://photos.example.com/photo.jpg",
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
      hasPreview: true,
    });
    mocks.readLinkPreview.mockResolvedValueOnce(new Uint8Array([1, 2, 3]));

    const response = await GET(
      new Request("http://aperture.test"),
      context("link-1"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toContain("max-age=3600");
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      1, 2, 3,
    ]);
  });

  it("uses the registry id, not the raw route param, for the file lookup", async () => {
    mocks.findLink.mockResolvedValueOnce({
      id: "safe-id",
      title: "Photo",
      ownerId: "owner",
      sourceUrl: "https://photos.example.com/photo.jpg",
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
      hasPreview: true,
    });
    mocks.readLinkPreview.mockResolvedValueOnce(new Uint8Array([1]));

    const response = await GET(
      new Request("http://aperture.test"),
      context("../secret"),
    );

    expect(response.status).toBe(200);
    expect(mocks.readLinkPreview).toHaveBeenCalledWith("safe-id");
  });
});
