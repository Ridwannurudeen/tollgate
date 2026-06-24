import {
  APERTURE_IMMICH_API_BASE_URL,
  APERTURE_LICENSE_FEE_ATOMIC_USDC,
} from "./config";
import {
  readLicenseLedger,
  summarizeLedger,
  verifyLicenseLedger,
} from "./ledger";
import { readWalletRegistry } from "./registry";

export async function buildProofPack() {
  const [ledger, registry] = await Promise.all([
    readLicenseLedger(),
    readWalletRegistry(),
  ]);
  const creators = summarizeLedger(ledger);
  const totalEarnedAtomicUsdc = creators.reduce(
    (sum, creator) => sum + creator.earned,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    verification: verifyLicenseLedger(ledger),
    totals: {
      receipts: ledger.receipts.length,
      registeredOwners: registry.photographers.length,
      totalEarnedAtomicUsdc,
      licenseFeeAtomicUsdc: APERTURE_LICENSE_FEE_ATOMIC_USDC,
    },
    settlement: {
      feeRouterEnabled: process.env.APERTURE_FEE_ROUTER_ENABLED === "1",
      immichApiBaseUrl: APERTURE_IMMICH_API_BASE_URL,
    },
    creators,
    registry,
    ledger,
  };
}
