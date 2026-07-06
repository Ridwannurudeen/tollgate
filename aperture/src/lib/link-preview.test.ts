import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildWatermarkedPreview,
  readLinkPreview,
  writeLinkPreview,
} from "./link-preview";

async function noisyInput(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3);
  let seed = 123456;
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    pixels[index] = seed & 255;
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

describe("link previews", () => {
  it("builds a smaller watermarked webp with a 600px max edge", async () => {
    const input = await noisyInput(1200, 900);

    const preview = await buildWatermarkedPreview(new Uint8Array(input));
    const metadata = await sharp(preview.bytes).metadata();

    expect(preview.contentType).toBe("image/webp");
    expect(metadata.format).toBe("webp");
    expect(
      Math.max(metadata.width ?? 0, metadata.height ?? 0),
    ).toBeLessThanOrEqual(600);
    expect(preview.bytes.byteLength).toBeLessThan(input.byteLength);
  });

  it("composites a visible watermark over otherwise flat image bytes", async () => {
    const input = await sharp({
      create: {
        width: 900,
        height: 600,
        channels: 3,
        background: { r: 120, g: 170, b: 210 },
      },
    })
      .png()
      .toBuffer();

    const preview = await buildWatermarkedPreview(new Uint8Array(input));
    const raw = await sharp(preview.bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = raw.info;
    const rowAverage = (row: number): number => {
      let total = 0;
      for (let column = 0; column < width; column += 1) {
        const offset = (row * width + column) * channels;
        total +=
          raw.data[offset] * 0.2126 +
          raw.data[offset + 1] * 0.7152 +
          raw.data[offset + 2] * 0.0722;
      }
      return total / width;
    };

    expect(rowAverage(Math.floor(height / 2))).toBeLessThan(rowAverage(20) - 8);
  });

  it("writes and reads only webp files inside the preview directory", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-previews-"));
    try {
      const bytes = new Uint8Array([1, 2, 3]);

      await writeLinkPreview("safe-id", bytes, dir);
      await expect(writeLinkPreview("../secret", bytes, dir)).rejects.toThrow(
        /outside the preview directory/,
      );

      expect(Array.from(await readLinkPreview("safe-id", dir))).toEqual([
        1, 2, 3,
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
