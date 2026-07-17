import { APERTURE_LICENSE_FEE_ATOMIC_USDC } from "./config";
import { readFeeRouterSplitRegistry } from "./fee-router";
import {
  readLicenseLedger,
  summarizeLedger,
  verifyLicenseLedger,
} from "./ledger";
import { projectPublicData, publicLicenseLedger } from "./public-data";
import { publicWalletRegistryEntry, readWalletRegistry } from "./registry";

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
  const publicRegistry = {
    photographers: registry.photographers.map(publicWalletRegistryEntry),
  };

  return projectPublicData({
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
    },
    creators,
    feeRouterSplits: splitRegistry,
    registry: publicRegistry,
    ledger: publicLicenseLedger(ledger),
  });
}
