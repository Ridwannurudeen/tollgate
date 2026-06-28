import { getAddress, isAddress } from "viem";
import { NextResponse } from "next/server";
import { APERTURE_IMMICH_API_BASE_URL } from "../../../lib/config";
import { resolveSharedLink } from "../../../lib/immich";
import { appendLicenseReceipt } from "../../../lib/ledger";
import {
  handleLicenseDownload,
  type LicenseDownloadRequest,
} from "../../../lib/license-download";
import { readWalletForOwner } from "../../../lib/registry";
import { routeLicensePayment } from "../../../lib/fee-router";
import { publicOrigin } from "../../../lib/x402-server";

export const runtime = "nodejs";

function requestBody(value: unknown): LicenseDownloadRequest | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.sharedLinkKey !== "string") return null;
  return {
    sharedLinkKey: record.sharedLinkKey,
    ...(Array.isArray(record.assetIds) &&
    record.assetIds.every((assetId) => typeof assetId === "string")
      ? { assetIds: record.assetIds }
      : {}),
  };
}

export async function POST(request: Request) {
  const parsed = requestBody(await request.json().catch(() => null));
  if (!parsed) {
    return NextResponse.json(
      { error: "sharedLinkKey is required" },
      { status: 400 },
    );
  }

  const collector = process.env.APERTURE_LICENSE_COLLECTOR_ADDRESS;
  const result = await handleLicenseDownload(parsed, {
    headers: request.headers,
    origin: publicOrigin(request.headers, "http://127.0.0.1:3092"),
    basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
    ...(collector && isAddress(collector)
      ? { collectorAddress: getAddress(collector) }
      : {}),
    localProofEnabled: process.env.APERTURE_LICENSE_LOCAL_PROOF === "1",
    resolveSharedLink: (key) =>
      resolveSharedLink(APERTURE_IMMICH_API_BASE_URL, key),
    findWalletForOwner: readWalletForOwner,
    routeLicensePayment,
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
