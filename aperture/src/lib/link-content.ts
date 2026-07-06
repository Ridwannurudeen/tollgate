import { sha256Hex } from "./hash";
import { safeFetch, type SafeFetchOptions } from "./safe-fetch";

export const LINK_PROBE_MAX_BYTES = 64 * 1024;
export const LINK_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/tiff",
]);

export type LinkImageEvidence = {
  contentType: string;
  sourceContentHash: `0x${string}`;
};

export type LinkImageBytes = LinkImageEvidence & {
  bytes: Uint8Array;
};

function normalizedContentType(contentType: string | null): string | null {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType && ALLOWED_IMAGE_TYPES.has(mediaType) ? mediaType : null;
}

function assertImageResponse(response: Response): string {
  if (!response.ok) {
    throw new Error("photo URL did not return a successful image response.");
  }
  const contentType = normalizedContentType(
    response.headers.get("content-type"),
  );
  if (!contentType) {
    throw new Error(
      "photo URL must return jpeg, png, webp, gif, avif, or tiff.",
    );
  }
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const bytes = Number.parseInt(contentLength, 10);
    if (Number.isFinite(bytes) && bytes > LINK_DOWNLOAD_MAX_BYTES) {
      throw new Error("photo is larger than the 25 MB download cap.");
    }
  }
  return contentType;
}

async function readCappedResponseBytes(
  response: Response,
  maxBytes: number,
  mode: "truncate" | "reject",
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      if (mode === "reject") throw new Error("photo exceeds the download cap.");
      return bytes.slice(0, maxBytes);
    }
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let overLimit = false;
  try {
    while (totalBytes <= maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalBytes + value.byteLength > maxBytes) {
        overLimit = true;
        if (mode === "truncate") {
          const remaining = maxBytes - totalBytes;
          if (remaining > 0) {
            chunks.push(value.slice(0, remaining));
            totalBytes += remaining;
          }
        }
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    if (overLimit) {
      await reader.cancel().catch(() => undefined);
    } else {
      reader.releaseLock();
    }
  }

  if (overLimit && mode === "reject") {
    throw new Error("photo exceeds the download cap.");
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function contentHash(sourceUrl: string, bytes: Uint8Array): `0x${string}` {
  return sha256Hex({
    url: sourceUrl,
    body: Buffer.from(bytes).toString("base64"),
  });
}

export async function probeImageSource(
  sourceUrl: string,
  options: SafeFetchOptions = {},
): Promise<LinkImageEvidence> {
  const url = new URL(sourceUrl);
  const response = await safeFetch(
    url,
    { headers: { range: `bytes=0-${LINK_PROBE_MAX_BYTES - 1}` } },
    options,
  );
  const contentType = assertImageResponse(response);
  const bytes = await readCappedResponseBytes(
    response,
    LINK_PROBE_MAX_BYTES,
    "truncate",
  );
  return {
    contentType,
    sourceContentHash: contentHash(url.toString(), bytes),
  };
}

export async function fetchImageBytes(
  sourceUrl: string,
  options: SafeFetchOptions = {},
): Promise<LinkImageBytes> {
  const url = new URL(sourceUrl);
  const response = await safeFetch(url, {}, options);
  const contentType = assertImageResponse(response);
  const bytes = await readCappedResponseBytes(
    response,
    LINK_DOWNLOAD_MAX_BYTES,
    "reject",
  );
  return {
    bytes,
    contentType,
    sourceContentHash: contentHash(url.toString(), bytes),
  };
}
