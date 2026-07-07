import sharp from "sharp";
import { LinkRegistryError } from "./link-registry";

// dHash catches resize/recompression-level copies; crops or heavy edits need
// a future review/provenance layer.
export const NEAR_DUPLICATE_THRESHOLD = 6;
export const LOW_DETAIL_STDDEV_THRESHOLD = 2;

export type DHashResult = {
  hash: string;
  grayscaleVariance: number;
  grayscaleStdDev: number;
  lowDetail: boolean;
};

function assertDHash(value: string): void {
  if (!/^[a-fA-F0-9]{16}$/.test(value)) {
    throw new LinkRegistryError("perceptual hash is invalid.");
  }
}

function grayscaleDetail(pixels: Buffer): Pick<
  DHashResult,
  "grayscaleVariance" | "grayscaleStdDev" | "lowDetail"
> {
  let sum = 0;
  for (const pixel of pixels) {
    sum += pixel;
  }
  const mean = sum / pixels.byteLength;
  let squaredDiff = 0;
  for (const pixel of pixels) {
    const diff = pixel - mean;
    squaredDiff += diff * diff;
  }
  const grayscaleVariance = squaredDiff / pixels.byteLength;
  const grayscaleStdDev = Math.sqrt(grayscaleVariance);
  return {
    grayscaleVariance,
    grayscaleStdDev,
    lowDetail: grayscaleStdDev < LOW_DETAIL_STDDEV_THRESHOLD,
  };
}

export async function computeDHash(
  imageBytes: Uint8Array,
): Promise<DHashResult> {
  let pixels: Buffer;
  try {
    const output = await sharp(imageBytes)
      .resize(9, 8, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    pixels = output.data;
  } catch {
    throw new LinkRegistryError("file is not a supported image.");
  }

  if (pixels.byteLength !== 72) {
    throw new LinkRegistryError("file is not a supported image.");
  }

  const detail = grayscaleDetail(pixels);
  let bits = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const offset = row * 9 + column;
      bits = (bits << 1n) | (pixels[offset] > pixels[offset + 1] ? 1n : 0n);
    }
  }
  return {
    hash: bits.toString(16).padStart(16, "0"),
    ...detail,
  };
}

export function hammingDistance(hashA: string, hashB: string): number {
  assertDHash(hashA);
  assertDHash(hashB);
  let diff = BigInt(`0x${hashA}`) ^ BigInt(`0x${hashB}`);
  let distance = 0;
  while (diff > 0n) {
    distance += Number(diff & 1n);
    diff >>= 1n;
  }
  return distance;
}
