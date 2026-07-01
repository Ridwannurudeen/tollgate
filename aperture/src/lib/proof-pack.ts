import {
  APERTURE_IMMICH_API_BASE_URL,
  APERTURE_LICENSE_FEE_ATOMIC_USDC,
} from "./config";
import { readFeeRouterSplitRegistry } from "./fee-router";
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
  const splitRegistry = await readFeeRouterSplitRegistry();
  const creators = summarizeLedger(ledger);
  const totalEarnedAtomicUsdc = creators.reduce(
    (sum, creator) => sum + creator.earned,
    0,
  );
  // Public payload: strip custodial Circle walletIds and ownershipProof so the
  // unauthenticated /api/proof endpoint never leaks them.
  const publicRegistry = {
    photographers: registry.photographers.map(
      ({ walletId, ownershipProof, ...entry }) => entry,
    ),
  };

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
    feeRouterSplits: splitRegistry,
    registry: publicRegistry,
    ledger,
  };
}
