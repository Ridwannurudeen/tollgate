import { APERTURE_IMMICH_API_BASE_URL } from "../src/lib/config";
import {
  createFeeRouterPublicClient,
  feeRouterV1Abi,
  FEE_ROUTER_ADDRESS,
} from "../src/lib/fee-router";
import { readLicenseLedger, verifyLicenseLedger } from "../src/lib/ledger";
import { readWalletRegistry } from "../src/lib/registry";

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

async function checkForum() {
  try {
    const splitCount = await createFeeRouterPublicClient().readContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterV1Abi,
      functionName: "splitCount",
    });
    return { ok: true, splitCount: splitCount.toString() };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

async function main() {
  const [immich, forum, ledger, registry] = await Promise.all([
    checkImmich(),
    checkForum(),
    readLicenseLedger(),
    readWalletRegistry(),
  ]);
  const ledgerVerification = verifyLicenseLedger(ledger);
  const result = {
    ok: immich.ok && forum.ok && ledgerVerification.ok,
    generatedAt: new Date().toISOString(),
    immich,
    forum,
    ledger: ledgerVerification,
    registry: { ownerCount: registry.photographers.length },
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
