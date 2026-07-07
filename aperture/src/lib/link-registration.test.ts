import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import type { LinkRecord, RegisterLinkInput } from "./link-registry";
import {
  handleLinkRegistration,
  handleLinkUploadRegistration,
} from "./link-registration";
import { LINK_DOWNLOAD_MAX_BYTES } from "./link-content";
import type { WalletRegistryEntry } from "./types";

const photographer: WalletRegistryEntry = {
  ownerId: "link-owner",
  displayName: "Jane Lens",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-07-06T00:00:00.000Z",
  approvalStatus: "operator-approved",
  custody: "self",
};

const loggedInPhotographer: WalletRegistryEntry = {
  ownerId: "existing-owner",
  displayName: "Existing Lens",
  wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
  createdAt: "2026-07-06T00:00:00.000Z",
  approvalStatus: "operator-approved",
  custody: "circle-w3s",
  walletId: "wallet-existing",
  accountKeyHash: `0x${"a".repeat(64)}`,
};

const hash = (char: string) => `0x${char.repeat(64)}` as `0x${string}`;

function registeredLink(input: RegisterLinkInput, id: string): LinkRecord {
  return {
    id,
    title: input.title,
    ...(input.description ? { description: input.description } : {}),
    ownerId: input.ownerId,
    ...(input.mediaKind ? { mediaKind: input.mediaKind } : {}),
    ...(input.sourceKind ? { sourceKind: input.sourceKind } : {}),
    ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
    contentType: input.contentType,
    originalContentType: input.originalContentType,
    sourceContentHash: input.sourceContentHash,
    ...(input.perceptualHash ? { perceptualHash: input.perceptualHash } : {}),
    priceAtomicUsdc: 2500,
    createdAt: "2026-07-06T00:00:00.000Z",
  };
}

function previewDeps(linkId: string, description?: string) {
  const previewBytes = new Uint8Array([9, 8, 7]);
  return {
    fetchImageBytes: vi.fn(async (_url: string) => ({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg" as const,
      sourceContentHash: hash("f"),
    })),
    computeDHash: vi.fn(async (_bytes: Uint8Array) => "1111111111111111"),
    findNearDuplicateLink: vi.fn(async (_perceptualHash: string) => null),
    buildWatermarkedPreview: vi.fn(async (_bytes: Uint8Array) => ({
      bytes: previewBytes,
      contentType: "image/webp" as const,
    })),
    writeLinkPreview: vi.fn(async (_id: string, _bytes: Uint8Array) => {}),
    markLinkPreviewGenerated: vi.fn(async (id: string) => ({
      id,
      title: "Photo",
      ...(description ? { description } : {}),
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

async function pngBytes(): Promise<Uint8Array> {
  const bytes = await sharp({
    create: {
      width: 12,
      height: 8,
      channels: 3,
      background: { r: 120, g: 170, b: 210 },
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

describe("handleLinkRegistration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches, hashes, registers the photographer, and returns only public link data", async () => {
    const registerCreator = vi.fn(async () => photographer);
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "link-1"),
    );
    const preview = previewDeps(
      "link-1",
      "A rainy evening street scene in Lagos.",
    );

    const result = await handleLinkRegistration(
      {
        sourceUrl: "https://photos.example.com/photo.jpg#hidden",
        title: "Photo",
        description: "  A rainy evening street scene in Lagos.  ",
        displayName: "Jane Lens",
        wallet: photographer.wallet,
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        ownerId: () => "link-owner",
        findLinkBySourceUrl: async () => null,
        findNearDuplicateLink: preview.findNearDuplicateLink,
        registerCreator,
        registerLink,
        generateAccountKey: () => "aptr_known-key",
        fetchImageBytes: preview.fetchImageBytes,
        computeDHash: preview.computeDHash,
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
      accountKeyHash: expect.stringMatching(/^0x[0-9a-f]{64}$/),
    });
    expect(result.accountKey).toBe("aptr_known-key");
    expect(result.registered.ownerId).toBe("link-owner");
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "A rainy evening street scene in Lagos.",
        perceptualHash: "1111111111111111",
      }),
    );
    expect(result.link.description).toBe(
      "A rainy evening street scene in Lagos.",
    );
    expect(preview.fetchImageBytes).toHaveBeenCalledWith(
      "https://photos.example.com/photo.jpg",
    );
    expect(preview.computeDHash).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(preview.findNearDuplicateLink).toHaveBeenCalledWith(
      "1111111111111111",
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

  it("rejects duplicate URLs before fetching or minting a wallet", async () => {
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
          registerCreator,
          fetchImageBytes,
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(registerCreator).not.toHaveBeenCalled();
    expect(fetchImageBytes).not.toHaveBeenCalled();
  });

  it("rejects near-duplicate URL photos before minting a wallet or registering the link", async () => {
    const registerCreator = vi.fn();
    const registerLink = vi.fn();
    const preview = previewDeps("link-duplicate");

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
          findLinkBySourceUrl: async () => null,
          findNearDuplicateLink: async () => ({
            id: "existing",
            title: "Existing",
            ownerId: "owner",
            sourceUrl: "https://photos.example.com/existing.jpg",
            perceptualHash: "1111111111111111",
            priceAtomicUsdc: 2500,
            createdAt: "2026-07-06T00:00:00.000Z",
          }),
          fetchImageBytes: preview.fetchImageBytes,
          computeDHash: preview.computeDHash,
          registerCreator,
          registerLink,
          buildWatermarkedPreview: preview.buildWatermarkedPreview,
          writeLinkPreview: preview.writeLinkPreview,
        },
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(preview.fetchImageBytes).toHaveBeenCalled();
    expect(preview.computeDHash).toHaveBeenCalled();
    expect(registerCreator).not.toHaveBeenCalled();
    expect(registerLink).not.toHaveBeenCalled();
    expect(preview.buildWatermarkedPreview).not.toHaveBeenCalled();
    expect(preview.writeLinkPreview).not.toHaveBeenCalled();
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
          findNearDuplicateLink: async () => null,
          registerCreator: async () => photographer,
          registerLink,
          generateAccountKey: () => "aptr_known-key",
          fetchImageBytes,
          computeDHash: async () => "2222222222222222",
          buildWatermarkedPreview,
          writeLinkPreview,
          markLinkPreviewGenerated,
        },
      );

      expect(result.link.hasPreview).toBeUndefined();
      expect(result.accountKey).toBe("aptr_known-key");
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

  it("stores a lowercased login email for a new logged-out account", async () => {
    const registerCreator = vi.fn(async () => ({
      ...photographer,
      email: "jane@example.com",
    }));
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "link-email"),
    );
    const preview = previewDeps("link-email");

    await handleLinkRegistration(
      {
        sourceUrl: "https://photos.example.com/email.jpg",
        title: "Email Photo",
        displayName: "Jane Lens",
        email: " Jane@Example.COM ",
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        ownerId: () => "link-owner",
        findLinkBySourceUrl: async () => null,
        findNearDuplicateLink: preview.findNearDuplicateLink,
        registerCreator,
        registerLink,
        generateAccountKey: () => "aptr_known-key",
        fetchImageBytes: preview.fetchImageBytes,
        computeDHash: preview.computeDHash,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );

    expect(registerCreator).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@example.com" }),
    );
  });

  it("rejects malformed login emails on new logged-out accounts", async () => {
    await expect(
      handleLinkRegistration(
        {
          sourceUrl: "https://photos.example.com/bad-email.jpg",
          title: "Bad Email",
          displayName: "Jane Lens",
          email: "not-an-email",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
          findLinkBySourceUrl: async () => null,
          findNearDuplicateLink: async () => null,
          fetchImageBytes: async () => ({
            bytes: new Uint8Array([1, 2, 3]),
            contentType: "image/jpeg",
            sourceContentHash: hash("9"),
          }),
          computeDHash: async () => "9999999999999999",
        },
      ),
    ).rejects.toThrow("email must be a valid address.");
  });

  it("rejects malformed descriptions", async () => {
    await expect(
      handleLinkRegistration(
        {
          sourceUrl: "https://photos.example.com/bad-description.jpg",
          title: "Bad Description",
          description: { text: "not allowed" },
          displayName: "Jane Lens",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
        },
      ),
    ).rejects.toThrow("description must be a string.");
  });

  it("rejects overlong descriptions", async () => {
    await expect(
      handleLinkRegistration(
        {
          sourceUrl: "https://photos.example.com/long-description.jpg",
          title: "Long Description",
          description: "x".repeat(601),
          displayName: "Jane Lens",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
        },
      ),
    ).rejects.toThrow("description is too long.");
  });

  it("adds work to the logged-in owner without minting a new wallet or key", async () => {
    const registerCreator = vi.fn();
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "link-existing"),
    );
    const readWalletForOwner = vi.fn(async () => loggedInPhotographer);
    const preview = previewDeps("link-existing");

    const result = await handleLinkRegistration(
      {
        sourceUrl: "https://photos.example.com/second.jpg",
        title: "Second Photo",
        description: "Existing owner adds context for buyers.",
        displayName: "Ignored Name",
        wallet: "0x0000000000000000000000000000000000000001",
        email: "ignored@example.com",
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        sessionOwnerId: "existing-owner",
        findLinkBySourceUrl: async () => null,
        findNearDuplicateLink: preview.findNearDuplicateLink,
        registerCreator,
        registerLink,
        readWalletForOwner,
        generateAccountKey: () => "aptr_should-not-return",
        fetchImageBytes: preview.fetchImageBytes,
        computeDHash: preview.computeDHash,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );

    expect(readWalletForOwner).toHaveBeenCalledWith("existing-owner");
    expect(registerCreator).not.toHaveBeenCalled();
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "existing-owner",
        description: "Existing owner adds context for buyers.",
        sourceUrl: "https://photos.example.com/second.jpg",
      }),
    );
    expect(result.accountKey).toBeUndefined();
    expect(result.registered).toEqual({
      ownerId: "existing-owner",
      displayName: "Existing Lens",
      wallet: loggedInPhotographer.wallet,
      approvalStatus: "operator-approved",
      custody: "circle-w3s",
    });
  });
});

describe("handleLinkUploadRegistration", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("stores preview and original bytes before registering an upload link", async () => {
    const fileBytes = await pngBytes();
    const previewBytes = new Uint8Array([9, 8, 7]);
    const registerCreator = vi.fn(async () => photographer);
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "upload-1"),
    );
    const computeDHash = vi.fn(async () => "2222222222222222");
    const findNearDuplicateLink = vi.fn(async () => null);
    const buildWatermarkedPreview = vi.fn(async () => ({
      bytes: previewBytes,
      contentType: "image/webp" as const,
    }));
    const writeLinkPreview = vi.fn(async () => {});
    const writeLinkOriginal = vi.fn(async () => {});

    const result = await handleLinkUploadRegistration(
      {
        fileBytes,
        title: " Uploaded Photo ",
        description: "  Buyers see where this was shot.  ",
        displayName: "Jane Lens",
        wallet: photographer.wallet,
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        ownerId: () => "link-owner",
        linkId: () => "upload-1",
        registerCreator,
        registerLink,
        generateAccountKey: () => "aptr_upload-key",
        computeDHash,
        findNearDuplicateLink,
        buildWatermarkedPreview,
        writeLinkPreview,
        writeLinkOriginal,
      },
    );
    const json = JSON.stringify(result);

    expect(computeDHash).toHaveBeenCalledWith(fileBytes);
    expect(findNearDuplicateLink).toHaveBeenCalledWith("2222222222222222");
    expect(buildWatermarkedPreview).toHaveBeenCalledWith(fileBytes);
    expect(writeLinkPreview).toHaveBeenCalledWith("upload-1", previewBytes);
    expect(writeLinkOriginal).toHaveBeenCalledWith(
      "upload-1",
      fileBytes,
      "png",
    );
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "upload-1",
        title: "Uploaded Photo",
        description: "Buyers see where this was shot.",
        ownerId: "link-owner",
        sourceKind: "upload",
        originalContentType: "image/png",
        perceptualHash: "2222222222222222",
        hasPreview: true,
      }),
    );
    expect(
      (registerLink.mock.calls[0][0] as RegisterLinkInput).sourceContentHash,
    ).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.shareUrl).toBe(
      "https://tollgate.gudman.xyz/aperture/link/upload-1",
    );
    expect(result.accountKey).toBe("aptr_upload-key");
    expect(json).not.toContain("sourceUrl");
    expect(json).not.toContain("sourceContentHash");
  });

  it("stores a video thumbnail and original bytes before registering a video upload link", async () => {
    const fileBytes = new Uint8Array([1, 2, 3, 4]);
    const previewBytes = new Uint8Array([9, 8, 7]);
    const registerCreator = vi.fn(async () => photographer);
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "video-1"),
    );
    const representativeFrame = new Uint8Array([5, 6, 7]);
    const extractRepresentativeFrame = vi.fn(async () => representativeFrame);
    const computeDHash = vi.fn(async () => "3333333333333333");
    const findNearDuplicateLink = vi.fn(async () => null);
    const probeVideo = vi.fn(async () => ({
      contentType: "video/mp4" as const,
      ext: "mp4" as const,
      durationSeconds: 2,
      width: 320,
      height: 240,
    }));
    const buildVideoThumbnail = vi.fn(async () => ({
      bytes: previewBytes,
      contentType: "image/webp" as const,
    }));
    const buildWatermarkedPreview = vi.fn();
    const writeLinkPreview = vi.fn(async () => {});
    const writeLinkOriginal = vi.fn(async () => {});

    const result = await handleLinkUploadRegistration(
      {
        fileBytes,
        mediaKind: "video",
        title: " Uploaded Clip ",
        description: "  A short buyer-ready clip.  ",
        displayName: "Jane Lens",
        wallet: photographer.wallet,
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        ownerId: () => "link-owner",
        linkId: () => "video-1",
        registerCreator,
        registerLink,
        generateAccountKey: () => "aptr_video-key",
        probeVideo,
        extractRepresentativeFrame,
        computeDHash,
        findNearDuplicateLink,
        buildVideoThumbnail,
        buildWatermarkedPreview,
        writeLinkPreview,
        writeLinkOriginal,
      },
    );
    const json = JSON.stringify(result);

    expect(probeVideo).toHaveBeenCalledWith(fileBytes);
    expect(extractRepresentativeFrame).toHaveBeenCalledWith(fileBytes);
    expect(computeDHash).toHaveBeenCalledWith(representativeFrame);
    expect(findNearDuplicateLink).toHaveBeenCalledWith("3333333333333333");
    expect(buildVideoThumbnail).toHaveBeenCalledWith(fileBytes);
    expect(buildWatermarkedPreview).not.toHaveBeenCalled();
    expect(writeLinkPreview).toHaveBeenCalledWith("video-1", previewBytes);
    expect(writeLinkOriginal).toHaveBeenCalledWith(
      "video-1",
      fileBytes,
      "mp4",
    );
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "video-1",
        title: "Uploaded Clip",
        description: "A short buyer-ready clip.",
        ownerId: "link-owner",
        mediaKind: "video",
        sourceKind: "upload",
        originalContentType: "video/mp4",
        perceptualHash: "3333333333333333",
        hasPreview: true,
      }),
    );
    expect(result.link.mediaKind).toBe("video");
    expect(result.accountKey).toBe("aptr_video-key");
    expect(json).not.toContain("sourceUrl");
    expect(json).not.toContain("sourceContentHash");
  });

  it("rejects non-image upload bytes before creating an account", async () => {
    const registerCreator = vi.fn();
    const registerLink = vi.fn();

    await expect(
      handleLinkUploadRegistration(
        {
          fileBytes: new Uint8Array([1, 2, 3, 4]),
          title: "Bad Upload",
          displayName: "Jane Lens",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
          registerCreator,
          registerLink,
        },
      ),
    ).rejects.toThrow("file is not a supported image.");
    expect(registerCreator).not.toHaveBeenCalled();
    expect(registerLink).not.toHaveBeenCalled();
  });

  it("rejects near-duplicate uploads before creating an account or writing files", async () => {
    const fileBytes = await pngBytes();
    const registerCreator = vi.fn();
    const registerLink = vi.fn();
    const buildWatermarkedPreview = vi.fn();
    const writeLinkPreview = vi.fn();
    const writeLinkOriginal = vi.fn();

    await expect(
      handleLinkUploadRegistration(
        {
          fileBytes,
          title: "Copied Upload",
          displayName: "Jane Lens",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
          computeDHash: async () => "4444444444444444",
          findNearDuplicateLink: async () => ({
            id: "existing",
            title: "Existing",
            ownerId: "owner",
            sourceKind: "upload",
            sourceContentHash: hash("a"),
            perceptualHash: "4444444444444444",
            priceAtomicUsdc: 2500,
            createdAt: "2026-07-06T00:00:00.000Z",
          }),
          registerCreator,
          registerLink,
          buildWatermarkedPreview,
          writeLinkPreview,
          writeLinkOriginal,
        },
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(registerCreator).not.toHaveBeenCalled();
    expect(registerLink).not.toHaveBeenCalled();
    expect(buildWatermarkedPreview).not.toHaveBeenCalled();
    expect(writeLinkPreview).not.toHaveBeenCalled();
    expect(writeLinkOriginal).not.toHaveBeenCalled();
  });

  it("rejects oversized upload bytes before image decoding", async () => {
    await expect(
      handleLinkUploadRegistration(
        {
          fileBytes: new Uint8Array(LINK_DOWNLOAD_MAX_BYTES + 1),
          title: "Huge Upload",
          displayName: "Jane Lens",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
        },
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("adds uploads to the logged-in owner without minting a new wallet or key", async () => {
    const fileBytes = await pngBytes();
    const registerCreator = vi.fn();
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "upload-existing"),
    );
    const readWalletForOwner = vi.fn(async () => loggedInPhotographer);

    const result = await handleLinkUploadRegistration(
      {
        fileBytes,
        title: "Logged In Upload",
        displayName: "Ignored Name",
        wallet: "0x0000000000000000000000000000000000000001",
        email: "ignored@example.com",
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        sessionOwnerId: "existing-owner",
        linkId: () => "upload-existing",
        readWalletForOwner,
        registerCreator,
        registerLink,
        computeDHash: async () => "5555555555555555",
        findNearDuplicateLink: async () => null,
        buildWatermarkedPreview: async () => ({
          bytes: new Uint8Array([1]),
          contentType: "image/webp" as const,
        }),
        writeLinkPreview: async () => {},
        writeLinkOriginal: async () => {},
      },
    );

    expect(readWalletForOwner).toHaveBeenCalledWith("existing-owner");
    expect(registerCreator).not.toHaveBeenCalled();
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "existing-owner",
        sourceKind: "upload",
      }),
    );
    expect(result.accountKey).toBeUndefined();
    expect(result.registered.ownerId).toBe("existing-owner");
  });
});

describe("handleLinkRegistration URL normalization", () => {
  it("rewrites a GitHub blob viewer URL to its raw.githubusercontent.com equivalent", async () => {
    const registerLink = vi.fn(async (input: RegisterLinkInput) =>
      registeredLink(input, "link-gh"),
    );
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
        findNearDuplicateLink: preview.findNearDuplicateLink,
        registerCreator: async () => photographer,
        registerLink,
        generateAccountKey: () => "aptr_known-key",
        fetchImageBytes: preview.fetchImageBytes,
        computeDHash: preview.computeDHash,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );

    expect(preview.fetchImageBytes).toHaveBeenCalledWith(
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
        findNearDuplicateLink: preview.findNearDuplicateLink,
        registerCreator: async () => photographer,
        registerLink,
        generateAccountKey: () => "aptr_known-key",
        fetchImageBytes: preview.fetchImageBytes,
        computeDHash: preview.computeDHash,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );

    const expected =
      "https://drive.google.com/uc?export=view&id=1o7nT274PZHxOhcLtxpEsYrQ0LNZW6df-";
    expect(preview.fetchImageBytes).toHaveBeenCalledWith(expected);
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({ sourceUrl: expected }),
    );
  });

  it("leaves ordinary photo URLs unchanged", async () => {
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
        findNearDuplicateLink: preview.findNearDuplicateLink,
        registerCreator: async () => photographer,
        registerLink: async (input: RegisterLinkInput) =>
          registeredLink(input, "link-plain"),
        generateAccountKey: () => "aptr_known-key",
        fetchImageBytes: preview.fetchImageBytes,
        computeDHash: preview.computeDHash,
        buildWatermarkedPreview: preview.buildWatermarkedPreview,
        writeLinkPreview: preview.writeLinkPreview,
        markLinkPreviewGenerated: preview.markLinkPreviewGenerated,
      },
    );

    expect(preview.fetchImageBytes).toHaveBeenCalledWith(
      "https://photos.example.com/photo.webp",
    );
  });
});
