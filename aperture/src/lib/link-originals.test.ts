import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  originalExtensionForContentType,
  readLinkOriginal,
  writeLinkOriginal,
} from "./link-originals";

describe("link originals", () => {
  it("maps supported media content types to stored extensions", () => {
    expect(originalExtensionForContentType("image/jpeg")).toBe("jpg");
    expect(originalExtensionForContentType("image/png")).toBe("png");
    expect(originalExtensionForContentType("video/mp4")).toBe("mp4");
    expect(originalExtensionForContentType("video/webm")).toBe("webm");
    expect(originalExtensionForContentType("video/quicktime")).toBe("mov");
    expect(originalExtensionForContentType("text/html")).toBeNull();
  });

  it("writes and reads only files inside the originals directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-originals-"));
    try {
      const bytes = new Uint8Array([1, 2, 3]);

      await writeLinkOriginal("safe-id", bytes, "png", dir);
      await writeLinkOriginal("safe-video", bytes, "mp4", dir);
      await expect(
        writeLinkOriginal("../secret", bytes, "png", dir),
      ).rejects.toThrow(/outside the originals directory/);

      expect(Array.from(await readLinkOriginal("safe-id", "png", dir))).toEqual(
        [1, 2, 3],
      );
      expect(
        Array.from(await readLinkOriginal("safe-video", "mp4", dir)),
      ).toEqual([1, 2, 3]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
