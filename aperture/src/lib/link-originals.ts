import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ORIGINALS_DIR = path.join(process.cwd(), "data", "originals");

const ORIGINAL_EXTENSIONS = new Set([
  "jpg",
  "png",
  "webp",
  "gif",
  "avif",
  "tiff",
  "mp4",
  "webm",
  "mov",
]);

export type LinkOriginalExtension =
  | "jpg"
  | "png"
  | "webp"
  | "gif"
  | "avif"
  | "tiff"
  | "mp4"
  | "webm"
  | "mov";

export function originalExtensionForContentType(
  contentType: string,
): LinkOriginalExtension | null {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    case "image/tiff":
      return "tiff";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    default:
      return null;
  }
}

function originalPath(
  linkId: string,
  ext: LinkOriginalExtension,
  dir = ORIGINALS_DIR,
): string {
  if (!ORIGINAL_EXTENSIONS.has(ext)) {
    throw new Error("original extension is not supported.");
  }
  const fullPath = path.join(dir, `${linkId}.${ext}`);
  const relative = path.relative(dir, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("original path is outside the originals directory.");
  }
  return fullPath;
}

export async function writeLinkOriginal(
  linkId: string,
  bytes: Uint8Array,
  ext: LinkOriginalExtension,
  dir = ORIGINALS_DIR,
): Promise<void> {
  const filePath = originalPath(linkId, ext, dir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, bytes);
  await rename(tmpPath, filePath);
}

export async function readLinkOriginal(
  linkId: string,
  ext: LinkOriginalExtension,
  dir = ORIGINALS_DIR,
): Promise<Uint8Array> {
  return new Uint8Array(await readFile(originalPath(linkId, ext, dir)));
}

export async function assertLinkOriginalReadable(
  linkId: string,
  ext: LinkOriginalExtension,
  dir = ORIGINALS_DIR,
): Promise<void> {
  const info = await stat(originalPath(linkId, ext, dir));
  if (!info.isFile()) {
    throw new Error("original path is not a file.");
  }
}
