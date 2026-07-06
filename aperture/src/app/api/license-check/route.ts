import { NextResponse } from "next/server";
import { APERTURE_IMMICH_API_BASE_URL } from "../../../lib/config";
import { evaluateLicenseCheck } from "../../../lib/license-check";
import { readLicenseLedger } from "../../../lib/ledger";
import { readWalletForOwner } from "../../../lib/registry";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const result = await evaluateLicenseCheck(
    {
      originalUri: request.headers.get("x-original-uri"),
      originalMethod: request.headers.get("x-original-method"),
    },
    {
      immichApiBaseUrl: APERTURE_IMMICH_API_BASE_URL,
      readLicenseLedger,
      readWalletForOwner,
    },
  );

  if (result.allowed) return new Response(null, { status: result.status });
  return NextResponse.json(result.body, { status: result.status });
}
