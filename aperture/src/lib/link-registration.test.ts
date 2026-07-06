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
