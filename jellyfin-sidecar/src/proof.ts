import { readPlaybackLedger, verifyPlaybackLedger } from "./ledger.js";
import { readCreatorRegistry } from "./registry.js";

export type ProofPackOptions = {
  ledgerPath: string;
  registryPath: string;
  defaultAtomicUsdcPerMinute: number;
  feeRouterMode: "dry-run";
};

export async function buildProofPack(options: ProofPackOptions) {
  const [ledger, registry] = await Promise.all([
    readPlaybackLedger(options.ledgerPath),
    readCreatorRegistry(options.registryPath),
  ]);
  const verification = verifyPlaybackLedger(ledger);
  const totalWatchedMinutes = ledger.receipts.reduce(
    (sum, receipt) => sum + receipt.watchedMinutes,
    0,
  );
  const totalAtomicUsdc = ledger.receipts.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    status: "BUILT-NOT-LIVE-RUN",
    readiness: "READY-needs-Jellyfin-instance",
    verification,
    totals: {
      receipts: ledger.receipts.length,
      registeredVideos: registry.videos.length,
      totalWatchedMinutes,
      totalAtomicUsdc,
      defaultAtomicUsdcPerMinute: options.defaultAtomicUsdcPerMinute,
    },
    settlement: {
      feeRouterMode: options.feeRouterMode,
      liveSpendEnabled: false,
    },
    registry,
    ledger,
  };
}

export async function buildHealth(options: ProofPackOptions) {
  const [ledger, registry] = await Promise.all([
    readPlaybackLedger(options.ledgerPath),
    readCreatorRegistry(options.registryPath),
  ]);
  const verification = verifyPlaybackLedger(ledger);

  return {
    ok: verification.ok,
    generatedAt: new Date().toISOString(),
    status: "BUILT-NOT-LIVE-RUN",
    readiness: "READY-needs-Jellyfin-instance",
    ledger: verification,
    registry: {
      videos: registry.videos.length,
    },
    settlement: {
      feeRouterMode: options.feeRouterMode,
      liveSpendEnabled: false,
    },
  };
}
