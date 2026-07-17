import { NextResponse } from "next/server";
import { APERTURE_IMMICH_API_BASE_URL } from "../../../lib/config";
import {
  handleLicenseArchive,
  type LicenseArchiveBody,
} from "../../../lib/license-archive";
import { MAX_LICENSE_ASSET_IDS } from "../../../lib/license-download";
import { resolveSharedLink } from "../../../lib/immich";

export const runtime = "nodejs";

const MAX_SHARED_LINK_KEY_LENGTH = 512;
const MAX_AUTHORIZATION_LENGTH = 8_192;
const MAX_ASSET_ID_LENGTH = 256;

function requestBody(
  value: unknown,
): { assetIds: string[]; edited: false } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !Object.keys(record).every(
      (key) => key === "assetIds" || key === "edited",
    ) ||
    !Array.isArray(record.assetIds) ||
    record.assetIds.length === 0 ||
    record.assetIds.length > MAX_LICENSE_ASSET_IDS ||
    !record.assetIds.every(
      (assetId) =>
        typeof assetId === "string" &&
        assetId.length > 0 &&
        assetId.length <= MAX_ASSET_ID_LENGTH,
    ) ||
    record.edited !== false
  ) {
    return null;
  }
  return { assetIds: record.assetIds, edited: false };
}

function immichArchiveUrl(sharedLinkKey: string): string {
  const base = APERTURE_IMMICH_API_BASE_URL.endsWith("/")
    ? APERTURE_IMMICH_API_BASE_URL
    : `${APERTURE_IMMICH_API_BASE_URL}/`;
  const url = new URL("download/archive", base);
  url.searchParams.set("key", sharedLinkKey);
  return url.toString();
}

async function fetchImmichArchive(
  sharedLinkKey: string,
  body: LicenseArchiveBody,
): Promise<Response> {
  return fetch(immichArchiveUrl(sharedLinkKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
  });
}

function archiveHeaders(upstream: Headers): Headers {
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of [
    "content-disposition",
    "content-length",
    "content-type",
  ]) {
    const value = upstream.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const sharedLinkKey = url.searchParams.get("key") ?? "";
  const authorization =
    url.searchParams.get("tollgateAuthorization") ?? "";
  if (
    !sharedLinkKey ||
    sharedLinkKey.length > MAX_SHARED_LINK_KEY_LENGTH ||
    !authorization ||
    authorization.length > MAX_AUTHORIZATION_LENGTH
  ) {
    return NextResponse.json(
      { error: "valid archive authorization is required" },
      { status: 403 },
    );
  }

  const body = requestBody(await request.json().catch(() => null));
  if (!body) {
    return NextResponse.json(
      { error: "assetIds and edited=false are required" },
      { status: 400 },
    );
  }

  const result = await handleLicenseArchive(
    {
      sharedLinkKey,
      authorization,
      method: request.method,
      ...body,
    },
    {
      resolveSharedLink: (key) =>
        resolveSharedLink(APERTURE_IMMICH_API_BASE_URL, key),
      fetchArchive: fetchImmichArchive,
    },
  );
  if (!("response" in result)) {
    return NextResponse.json(result.body, { status: result.status });
  }

  return new Response(result.response.body, {
    status: 200,
    headers: archiveHeaders(result.response.headers),
  });
}
