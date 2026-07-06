import { describe, expect, it, vi } from "vitest";
import { LinkRegistryError } from "./link-registry";
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

describe("handleLinkRegistration", () => {
  it("probes, registers the photographer, and returns only public link data", async () => {
    const registerCreator = vi.fn(async () => photographer);
    const registerLink = vi.fn(async (input) => ({
      id: "link-1",
      title: input.title,
      ownerId: input.ownerId,
      sourceUrl: input.sourceUrl,
      contentType: input.contentType,
      sourceContentHash: input.sourceContentHash,
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
    }));

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
          sourceContentHash: `0x${"1".repeat(64)}`,
        }),
        registerCreator,
        registerLink,
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
    expect(json).not.toContain("photos.example.com");
    expect(json).not.toContain("sourceUrl");
  });

  it("rejects duplicate URLs before probing or minting a wallet", async () => {
    const probeImageSource = vi.fn();
    const registerCreator = vi.fn();
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
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(probeImageSource).not.toHaveBeenCalled();
    expect(registerCreator).not.toHaveBeenCalled();
  });
});

describe("handleLinkRegistration URL normalization", () => {
  it("rewrites a GitHub blob viewer URL to its raw.githubusercontent.com equivalent", async () => {
    const registerLink = vi.fn(async (input) => ({
      id: "link-gh",
      title: input.title,
      ownerId: input.ownerId,
      sourceUrl: input.sourceUrl,
      contentType: input.contentType,
      sourceContentHash: input.sourceContentHash,
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
    }));
    const probeImageSource = vi.fn(async () => ({
      contentType: "image/png" as const,
      sourceContentHash: `0x${"2".repeat(64)}` as `0x${string}`,
    }));

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
      },
    );

    expect(probeImageSource).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/owner/repo/main/photo.png",
    );
    expect(registerLink).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://raw.githubusercontent.com/owner/repo/main/photo.png",
      }),
    );
  });

  it("rewrites a Google Drive view URL to its direct-serve equivalent", async () => {
    const registerLink = vi.fn(async (input) => ({
      id: "link-drive",
      title: input.title,
      ownerId: input.ownerId,
      sourceUrl: input.sourceUrl,
      contentType: input.contentType,
      sourceContentHash: input.sourceContentHash,
      priceAtomicUsdc: 2500,
      createdAt: "2026-07-06T00:00:00.000Z",
    }));
    const probeImageSource = vi.fn(async () => ({
      contentType: "image/jpeg" as const,
      sourceContentHash: `0x${"3".repeat(64)}` as `0x${string}`,
    }));

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
      sourceContentHash: `0x${"4".repeat(64)}` as `0x${string}`,
    }));

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
        registerLink: async (input) => ({
          id: "link-plain",
          title: input.title,
          ownerId: input.ownerId,
          sourceUrl: input.sourceUrl,
          contentType: input.contentType,
          sourceContentHash: input.sourceContentHash,
          priceAtomicUsdc: 2500,
          createdAt: "2026-07-06T00:00:00.000Z",
        }),
      },
    );

    expect(probeImageSource).toHaveBeenCalledWith(
      "https://photos.example.com/photo.webp",
    );
  });
});
