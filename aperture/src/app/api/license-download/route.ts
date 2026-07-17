import { NextResponse } from "next/server";
import { APERTURE_IMMICH_API_BASE_URL } from "../../../lib/config";
import { resolveSharedLink } from "../../../lib/immich";
import { appendLicenseReceipt } from "../../../lib/ledger";
import {
  handleLicenseDownload,
  MAX_LICENSE_ASSET_IDS,
  type LicenseDownloadRequest,
} from "../../../lib/license-download";
import { assertLicenseDownloadRateLimit } from "../../../lib/link-rate-limit";
import { readWalletForOwner } from "../../../lib/registry";
import { aperturePublicOrigin } from "../../../lib/public-origin";

export const runtime = "nodejs";

const MAX_LICENSE_ASSET_ID_LENGTH = 256;

function requestBody(value: unknown): LicenseDownloadRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sharedLinkKey !== "string") return null;
  if (
    record.assetIds !== undefined &&
    (!Array.isArray(record.assetIds) ||
      record.assetIds.length > MAX_LICENSE_ASSET_IDS ||
      !record.assetIds.every(
        (assetId) =>
          typeof assetId === "string" &&
          assetId.length > 0 &&
          assetId.length <= MAX_LICENSE_ASSET_ID_LENGTH,
      ))
  ) {
    return null;
  }
  return {
    sharedLinkKey: record.sharedLinkKey,
    ...(record.assetIds !== undefined ? { assetIds: record.assetIds } : {}),
  };
}

function requestIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim());
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "local";
}

export async function POST(request: Request) {
  try {
    assertLicenseDownloadRateLimit(requestIp(request));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "license download limited",
      },
      { status: 429 },
    );
  }

  const parsed = requestBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      {
        error:
          "sharedLinkKey is required; assetIds may contain up to 100 valid IDs",
      },
      { status: 400 },
    );
  }

  const result = await handleLicenseDownload(parsed, {
    headers: request.headers,
    origin: aperturePublicOrigin(),
    basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
    localProofEnabled: process.env.APERTURE_LICENSE_LOCAL_PROOF === "1",
    resolveSharedLink: (key) =>
      resolveSharedLink(APERTURE_IMMICH_API_BASE_URL, key),
    findWalletForOwner: readWalletForOwner,
    appendReceipt: async (input) => {
      const result = await appendLicenseReceipt(input);
      return { receipt: result.receipt, created: result.created };
    },
  });

  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
