import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  LOW_DETAIL_STDDEV_THRESHOLD,
  NEAR_DUPLICATE_THRESHOLD,
  computeDHash,
  hammingDistance,
} from "./perceptual-hash";

async function gradientImage(reverse = false): Promise<Uint8Array> {
  const width = 64;
  const height = 64;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = reverse
        ? 255 - Math.round((x / (width - 1)) * 255)
        : Math.round((x / (width - 1)) * 255);
      const offset = (y * width + x) * 3;
      pixels[offset] = value;
      pixels[offset + 1] = value;
      pixels[offset + 2] = value;
    }
  }
  const bytes = await sharp(pixels, {
    raw: { width, height, channels: 3 },
  })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

async function flatImage(background: {
  r: number;
  g: number;
  b: number;
}): Promise<Uint8Array> {
  const bytes = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background,
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(bytes);
}

describe("perceptual hash", () => {
  it("counts known hamming distances", () => {
    expect(hammingDistance("0000000000000000", "0000000000000000")).toBe(0);
    expect(hammingDistance("0000000000000000", "ffffffffffffffff")).toBe(64);
  });

  it("keeps a resized recompressed image within the duplicate threshold", async () => {
    const original = await gradientImage();
    const recompressed = await sharp(original)
      .resize(48, 48)
      .jpeg({ quality: 65 })
      .toBuffer();

    const originalHash = await computeDHash(original);
    const recompressedHash = await computeDHash(new Uint8Array(recompressed));

    expect(originalHash.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(originalHash.lowDetail).toBe(false);
    expect(originalHash.grayscaleStdDev).toBeGreaterThanOrEqual(
      LOW_DETAIL_STDDEV_THRESHOLD,
    );
    expect(
      hammingDistance(originalHash.hash, recompressedHash.hash),
    ).toBeLessThanOrEqual(NEAR_DUPLICATE_THRESHOLD);
  });

  it("separates visually opposite gradients", async () => {
    const ascending = await computeDHash(await gradientImage());
    const descending = await computeDHash(await gradientImage(true));

    expect(hammingDistance(ascending.hash, descending.hash)).toBeGreaterThan(
      NEAR_DUPLICATE_THRESHOLD,
    );
  });

  it("marks flat images as low-detail even when their colors differ", async () => {
    const blue = await computeDHash(await flatImage({ r: 24, g: 80, b: 180 }));
    const red = await computeDHash(await flatImage({ r: 180, g: 40, b: 24 }));

    expect(blue.hash).toBe("0000000000000000");
    expect(red.hash).toBe(blue.hash);
    expect(blue.grayscaleVariance).toBe(0);
    expect(red.grayscaleVariance).toBe(0);
    expect(blue.grayscaleStdDev).toBeLessThan(LOW_DETAIL_STDDEV_THRESHOLD);
    expect(red.grayscaleStdDev).toBeLessThan(LOW_DETAIL_STDDEV_THRESHOLD);
    expect(blue.lowDetail).toBe(true);
    expect(red.lowDetail).toBe(true);
  });

  it("rejects unsupported image bytes", async () => {
    await expect(computeDHash(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "file is not a supported image.",
    );
  });
});
