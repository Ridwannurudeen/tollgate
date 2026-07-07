import sharp from "sharp";
import { LinkRegistryError } from "./link-registry";

// dHash catches resize/recompression-level copies; crops or heavy edits need
// a future review/provenance layer.
export const NEAR_DUPLICATE_THRESHOLD = 6;

function assertDHash(value: string): void {
  if (!/^[a-fA-F0-9]{16}$/.test(value)) {
    throw new LinkRegistryError("perceptual hash is invalid.");
  }
}

export async function computeDHash(imageBytes: Uint8Array): Promise<string> {
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

  let bits = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const offset = row * 9 + column;
      bits = (bits << 1n) | (pixels[offset] > pixels[offset + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
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
