import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleLinkUploadRegistration } from "./link-registration";

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
});
