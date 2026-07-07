import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const PREVIEW_DIR = path.join(process.cwd(), "data", "previews");
const PREVIEW_MAX_EDGE = 600;

export type LinkPreview = {
  bytes: Uint8Array;
  contentType: "image/webp";
};

function previewPath(linkId: string, dir = PREVIEW_DIR): string {
  const fullPath = path.join(dir, `${linkId}.webp`);
  const relative = path.relative(dir, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("preview path is outside the preview directory.");
  }
  return fullPath;
}

export function watermarkSvg(width: number, height: number): Buffer {
  const label = "TOLLGATE - PAY TO UNLOCK";
  const fontSize = Math.max(18, Math.round(Math.min(width, height) / 13));
  const bandHeight = Math.max(54, Math.round(fontSize * 1.8));
  const textX = width / 2;
  const textY = height / 2 + Math.round(fontSize / 3);
  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <pattern id="tile" width="260" height="150" patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
      <text x="0" y="76" fill="#ffffff" opacity="0.38" font-family="Arial, sans-serif" font-size="22" font-weight="700">${label}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#tile)" opacity="0.58" />
  <g transform="rotate(-18 ${textX} ${height / 2})">
    <rect x="${-width * 0.12}" y="${height / 2 - bandHeight / 2}" width="${width * 1.24}" height="${bandHeight}" fill="#071811" opacity="0.38" />
    <text x="${textX}" y="${textY}" text-anchor="middle" fill="#f6f2e7" opacity="0.82" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="800" letter-spacing="2">${label}</text>
  </g>
</svg>`);
}

export async function buildWatermarkedPreview(
  imageBytes: Uint8Array,
): Promise<LinkPreview> {
  try {
    const resized = await sharp(imageBytes)
      .rotate()
      .resize(PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .toBuffer({ resolveWithObject: true });
    const width = resized.info.width;
    const height = resized.info.height;
    if (!width || !height) {
      throw new Error("preview dimensions could not be read.");
    }
    const bytes = await sharp(resized.data)
      .composite([{ input: watermarkSvg(width, height), blend: "over" }])
      .webp({ quality: 55 })
      .toBuffer();
    return { bytes: new Uint8Array(bytes), contentType: "image/webp" };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unsupported image bytes";
    throw new Error(`preview generation failed: ${message}`);
  }
}

export async function writeLinkPreview(
  linkId: string,
  bytes: Uint8Array,
  dir = PREVIEW_DIR,
): Promise<void> {
  const filePath = previewPath(linkId, dir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, filePath);
}

export async function readLinkPreview(
  linkId: string,
  dir = PREVIEW_DIR,
): Promise<Uint8Array> {
  return new Uint8Array(await readFile(previewPath(linkId, dir)));
}
