import { NextResponse } from "next/server";
import { APERTURE_IMMICH_API_BASE_URL } from "../../../lib/config";
import { readLicenseLedger, verifyLicenseLedger } from "../../../lib/ledger";
import { readWalletRegistry } from "../../../lib/registry";

export const dynamic = "force-dynamic";

function pingUrl(): URL {
  const base = APERTURE_IMMICH_API_BASE_URL.endsWith("/")
    ? APERTURE_IMMICH_API_BASE_URL
    : `${APERTURE_IMMICH_API_BASE_URL}/`;
  return new URL("server/ping", base);
}

async function checkImmich() {
  try {
    const response = await fetch(pingUrl(), { cache: "no-store" });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export async function GET() {
  const [immich, ledger, registry] = await Promise.all([
    checkImmich(),
    readLicenseLedger(),
    readWalletRegistry(),
  ]);
  const ledgerVerification = verifyLicenseLedger(ledger);
  return NextResponse.json({
    ok: immich.ok && ledgerVerification.ok,
    generatedAt: new Date().toISOString(),
    immich,
    ledger: ledgerVerification,
    registry: { ownerCount: registry.photographers.length },
  });
}
