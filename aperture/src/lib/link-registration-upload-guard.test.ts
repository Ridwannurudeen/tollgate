import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleLinkUploadRegistration } from "./link-registration";
import type { RegisterLinkInput } from "./link-registry";
import type { WalletRegistryEntry } from "./types";

const mocks = vi.hoisted(() => ({
  metadata: vi.fn(),
}));

vi.mock("sharp", () => ({
  default: () => ({
    metadata: mocks.metadata,
  }),
}));

describe("handleLinkUploadRegistration upload guards", () => {
  beforeEach(() => {
    mocks.metadata.mockReset();
  });

  it("rejects excessive image dimensions before creating an account", async () => {
    const registerCreator = vi.fn();
    const buildWatermarkedPreview = vi.fn();
    mocks.metadata.mockResolvedValue({
      format: "png",
      width: 13_000,
      height: 1,
    });

    await expect(
      handleLinkUploadRegistration(
        {
          fileBytes: new Uint8Array([1, 2, 3]),
          title: "Huge Dimensions",
          displayName: "Jane Lens",
        },
        {
          origin: "https://tollgate.gudman.xyz",
          basePath: "/aperture",
          registerCreator,
          buildWatermarkedPreview,
        },
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(registerCreator).not.toHaveBeenCalled();
    expect(buildWatermarkedPreview).not.toHaveBeenCalled();
  });

  it("routes video uploads through video probing instead of image metadata", async () => {
    const photographer: WalletRegistryEntry = {
      ownerId: "link-owner",
      displayName: "Jane Lens",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      createdAt: "2026-07-06T00:00:00.000Z",
      approvalStatus: "operator-approved",
    };
    const registerCreator = vi.fn(async () => photographer);
    const registerLink = vi.fn(async (input: RegisterLinkInput) => ({
      id: "video-1",
      title: input.title,
      ownerId: input.ownerId,
      mediaKind: input.mediaKind,
      sourceKind: input.sourceKind,
      originalContentType: input.originalContentType,
      sourceContentHash: input.sourceContentHash,
      hasPreview: input.hasPreview,
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
    }));
    const probeVideo = vi.fn(async () => ({
      contentType: "video/mp4" as const,
      ext: "mp4" as const,
      durationSeconds: 2,
      width: 320,
      height: 240,
    }));
    const buildVideoThumbnail = vi.fn(async () => ({
      bytes: new Uint8Array([7]),
      contentType: "image/webp" as const,
    }));

    await handleLinkUploadRegistration(
      {
        fileBytes: new Uint8Array([1, 2, 3]),
        mediaKind: "video",
        title: "Video",
        displayName: "Jane Lens",
      },
      {
        origin: "https://tollgate.gudman.xyz",
        basePath: "/aperture",
        linkId: () => "video-1",
        registerCreator,
        registerLink,
        generateAccountKey: () => "aptr_key",
        probeVideo,
        buildVideoThumbnail,
        writeLinkPreview: async () => {},
        writeLinkOriginal: async () => {},
      },
    );

    expect(mocks.metadata).not.toHaveBeenCalled();
    expect(probeVideo).toHaveBeenCalled();
    expect(buildVideoThumbnail).toHaveBeenCalled();
  });
});
