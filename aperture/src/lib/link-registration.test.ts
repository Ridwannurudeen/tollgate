import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkRecord, RegisterLinkInput } from "./link-registry";
import { handleLinkRegistration } from "./link-registration";
import type { WalletRegistryEntry } from "./types";

const photographer: WalletRegistryEntry = {
  ownerId: "link-owner",
  displayName: "Jane Lens",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-07-06T00:00:00.000Z",
  approvalStatus: "operator-approved",
  custody: "self",
};

const hash = (char: string) => `0x${char.repeat(64)}` as `0x${string}`;

function registeredLink(input: RegisterLinkInput, id: string): LinkRecord {
  return {
    id,
    title: input.title,
    ownerId: input.ownerId,
    sourceUrl: input.sourceUrl,
    contentType: input.contentType,
    sourceContentHash: input.sourceContentHash,
    priceAtomicUsdc: 2500,
    createdAt: "2026-07-06T00:00:00.000Z",
  };
}

function previewDeps(linkId: string) {
  const previewBytes = new Uint8Array([9, 8, 7]);
  return {
    fetchImageBytes: vi.fn(async (_url: string) => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg" as const,
      sourceContentHash: hash("f"),
    })),
    buildWatermarkedPreview: vi.fn(async (_bytes: Uint8Array) => ({
      bytes: previewBytes,
      contentType: "image/webp" as const,
    })),
    writeLinkPreview: vi.fn(async (_id: string, _bytes: Uint8Array) => {}),
    markLinkPreviewGenerated: vi.fn(async (id: string) => ({
      id,
      title: "Photo",
      ownerId: "link-owner",
      sourceUrl: "https://photos.example.com/photo.jpg",
      contentType: "image/jpeg",
      sourceContentHash: hash("f"),
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
      hasPreview: id === linkId,
    })),
    previewBytes,
  };
}

describe("handleLinkRegistration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("probes, registers the photographer, and returns only public link data", async () => {
    const registerCreator = vi.fn(async () => photographer);
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "link-1"),
    );
    const preview = previewDeps("link-1");

    const result = await handleLinkRegistration(
      {
        sourceUrl: "https://photos.example.com/photo.jpg#hidden",
        title: "Photo",
        displayName: "Jane Lens",
        wallet: photographer.wallet,
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        ownerId: () => "link-owner",
        findLinkBySourceUrl: async () => null,
        probeImageSource: async () => ({
          contentType: "image/jpeg",
          sourceContentHash: hash("1"),
        }),
        registerCreator,
        registerLink,
        fetchImageBytes: preview.fetchImageBytes,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );
    const json = JSON.stringify(result);

    expect(result.shareUrl).toBe(
      "https://tollgate.gudman.xyz/aperture/link/link-1",
    );
    expect(registerCreator).toHaveBeenCalledWith({
      ownerId: "link-owner",
      displayName: "Jane Lens",
      wallet: photographer.wallet,
    });
    expect(preview.fetchImageBytes).toHaveBeenCalledWith(
      "https://photos.example.com/photo.jpg",
    );
    expect(preview.buildWatermarkedPreview).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
    );
    expect(preview.writeLinkPreview).toHaveBeenCalledWith(
      "link-1",
      preview.previewBytes,
    );
    expect(preview.markLinkPreviewGenerated).toHaveBeenCalledWith("link-1");
    expect(result.link.hasPreview).toBe(true);
    expect(json).not.toContain("photos.example.com");
    expect(json).not.toContain("sourceUrl");
  });

  it("rejects duplicate URLs before probing or minting a wallet", async () => {
    const probeImageSource = vi.fn();
    const registerCreator = vi.fn();
    const fetchImageBytes = vi.fn();
    await expect(
      handleLinkRegistration(
        {
          sourceUrl: "https://photos.example.com/photo.jpg",
          title: "Photo",
          displayName: "Jane Lens",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
          findLinkBySourceUrl: async () => ({
            id: "existing",
            title: "Existing",
            ownerId: "owner",
            sourceUrl: "https://photos.example.com/photo.jpg",
            priceAtomicUsdc: 2500,
            createdAt: "2026-07-06T00:00:00.000Z",
          }),
          probeImageSource,
          registerCreator,
          fetchImageBytes,
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(probeImageSource).not.toHaveBeenCalled();
    expect(registerCreator).not.toHaveBeenCalled();
    expect(fetchImageBytes).not.toHaveBeenCalled();
  });

  it("still registers the gated link when preview generation fails", async () => {
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "link-no-preview"),
    );
    const fetchImageBytes = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg" as const,
      sourceContentHash: hash("5"),
    }));
    const buildWatermarkedPreview = vi.fn(async () => {
      throw new Error("unsupported image");
    });
    const writeLinkPreview = vi.fn();
    const markLinkPreviewGenerated = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const result = await handleLinkRegistration(
        {
          sourceUrl: "https://photos.example.com/photo.jpg",
          title: "Photo",
          displayName: "Jane Lens",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
          ownerId: () => "link-owner",
          findLinkBySourceUrl: async () => null,
          probeImageSource: async () => ({
            contentType: "image/jpeg",
            sourceContentHash: hash("6"),
          }),
          registerCreator: async () => photographer,
          registerLink,
          fetchImageBytes,
          buildWatermarkedPreview,
          writeLinkPreview,
          markLinkPreviewGenerated,
        },
      );

      expect(result.link.hasPreview).toBeUndefined();
      expect(writeLinkPreview).not.toHaveBeenCalled();
      expect(markLinkPreviewGenerated).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "Skipping Aperture preview for link-no-preview",
        ),
      );
      expect(JSON.stringify(result)).not.toContain("photos.example.com");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("handleLinkRegistration URL normalization", () => {
  it("rewrites a GitHub blob viewer URL to its raw.githubusercontent.com equivalent", async () => {
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "link-gh"),
    );
    const probeImageSource = vi.fn(async () => ({
      contentType: "image/png" as const,
      sourceContentHash: hash("2"),
    }));
    const preview = previewDeps("link-gh");

    await handleLinkRegistration(
      {
        sourceUrl: "https://github.com/owner/repo/blob/main/photo.png",
        title: "Photo",
        displayName: "Jane Lens",
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        ownerId: () => "link-owner",
        findLinkBySourceUrl: async () => null,
        probeImageSource,
        registerCreator: async () => photographer,
        registerLink,
        fetchImageBytes: preview.fetchImageBytes,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );

    expect(probeImageSource).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/owner/repo/main/photo.png",
    );
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl:
          "https://raw.githubusercontent.com/owner/repo/main/photo.png",
      }),
    );
  });

  it("rewrites a Google Drive view URL to its direct-serve equivalent", async () => {
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "link-drive"),
    );
    const probeImageSource = vi.fn(async () => ({
      contentType: "image/jpeg" as const,
      sourceContentHash: hash("3"),
    }));
    const preview = previewDeps("link-drive");

    await handleLinkRegistration(
      {
        sourceUrl:
          "https://drive.google.com/file/d/1o7nT274PZHxOhcLtxpEsYrQ0LNZW6df-/view?usp=drive_link",
        title: "Photo",
        displayName: "Jane Lens",
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        ownerId: () => "link-owner",
        findLinkBySourceUrl: async () => null,
        probeImageSource,
        registerCreator: async () => photographer,
        registerLink,
        fetchImageBytes: preview.fetchImageBytes,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );

    const expected =
      "https://drive.google.com/uc?export=view&id=1o7nT274PZHxOhcLtxpEsYrQ0LNZW6df-";
    expect(probeImageSource).toHaveBeenCalledWith(expected);
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: expected }),
    );
  });

  it("leaves ordinary photo URLs unchanged", async () => {
    const probeImageSource = vi.fn(async () => ({
      contentType: "image/webp" as const,
      sourceContentHash: hash("4"),
    }));
    const preview = previewDeps("link-plain");

    await handleLinkRegistration(
      {
        sourceUrl: "https://photos.example.com/photo.webp",
        title: "Photo",
        displayName: "Jane Lens",
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        ownerId: () => "link-owner",
        findLinkBySourceUrl: async () => null,
        probeImageSource,
        registerCreator: async () => photographer,
        registerLink: async (input: RegisterLinkInput) =>
          registeredLink(input, "link-plain"),
        fetchImageBytes: preview.fetchImageBytes,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );

    expect(probeImageSource).toHaveBeenCalledWith(
      "https://photos.example.com/photo.webp",
    );
  });
});
