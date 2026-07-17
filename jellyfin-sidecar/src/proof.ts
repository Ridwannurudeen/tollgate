import { readPlaybackLedger, verifyPlaybackLedger } from "./ledger.js";
import { readCreatorRegistry } from "./registry.js";
import type { FeeRouterMode } from "./config.js";
import type { PlaybackLedger, PlaybackReceipt } from "./types.js";

const STATUS = "DOCKER-DRY-RUN-VALIDATED";
const READINESS = "READY-needs-real-Jellyfin-webhook-plugin-config";

export type ProofPackOptions = {
  ledgerPath: string;
  registryPath: string;
  defaultAtomicUsdcPerMinute: number;
  feeRouterMode: FeeRouterMode;
};

type PublicPlaybackReceipt = Omit<PlaybackReceipt, "userId" | "sessionId">;

function publicPlaybackReceipt(
  receipt: PlaybackReceipt,
): PublicPlaybackReceipt {
  return Object.fromEntries(
    Object.entries(receipt).filter(
      ([key]) => key !== "userId" && key !== "sessionId",
    ),
  ) as PublicPlaybackReceipt;
}

function isFixtureReplayReceipt(receipt: PlaybackReceipt): boolean {
  return (
    receipt.itemId === "video-demo-001" &&
    receipt.userId === "user-001" &&
    receipt.sessionId === "session-001"
  );
}

function summarizeReceiptOrigins(ledger: PlaybackLedger) {
  let fixtureReplayReceipts = 0;
  let nonFixtureReceipts = 0;
  let forumRoutedFixtureReceipts = 0;
  let forumRoutedNonFixtureReceipts = 0;

  for (const receipt of ledger.receipts) {
    const fixtureReplay = isFixtureReplayReceipt(receipt);
    if (fixtureReplay) {
      fixtureReplayReceipts += 1;
      if (receipt.settlement.settlementMode === "forum-routed") {
        forumRoutedFixtureReceipts += 1;
      }
      continue;
    }
    nonFixtureReceipts += 1;
    if (receipt.settlement.settlementMode === "forum-routed") {
      forumRoutedNonFixtureReceipts += 1;
    }
  }

  return {
    fixtureReplayReceipts,
    nonFixtureReceipts,
    forumRoutedFixtureReceipts,
    forumRoutedNonFixtureReceipts,
    note:
      forumRoutedNonFixtureReceipts > 0
        ? "At least one FeeRouter receipt came from a non-fixture Jellyfin webhook payload."
        : forumRoutedFixtureReceipts > 0
          ? "FeeRouter live mode was proven with the checked-in PlaybackStart/PlaybackStop fixture replay; a real Jellyfin Webhook plugin event is still pending."
          : "No live FeeRouter Jellyfin receipt has been recorded yet.",
  };
}

function statusForProof(
  feeRouterMode: FeeRouterMode,
  receiptOrigins: ReturnType<typeof summarizeReceiptOrigins>,
) {
  if (receiptOrigins.forumRoutedNonFixtureReceipts > 0) {
    return {
      status: "LIVE-FEEROUTER-VALIDATED",
      readiness: "READY-public-proof-and-webhook",
    };
  }
  if (receiptOrigins.forumRoutedFixtureReceipts > 0) {
    return {
      status: "LIVE-FEEROUTER-FIXTURE-REPLAY",
      readiness: "READY-needs-real-Jellyfin-webhook-plugin-event",
    };
  }
  if (feeRouterMode === "live") {
    return {
      status: "LIVE-FEEROUTER-READY",
      readiness: "READY-needs-live-Jellyfin-webhook-event",
    };
  }
  return { status: STATUS, readiness: READINESS };
}

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
  const hasForumRoutedReceipt = ledger.receipts.some(
    (receipt) => receipt.settlement.settlementMode === "forum-routed",
  );
  const receiptOrigins = summarizeReceiptOrigins(ledger);
  const proofStatus = statusForProof(options.feeRouterMode, receiptOrigins);

  return {
    generatedAt: new Date().toISOString(),
    status: proofStatus.status,
    readiness: proofStatus.readiness,
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
      liveSpendEnabled: options.feeRouterMode === "live",
      hasForumRoutedReceipt,
      hasForumRoutedFixtureReceipt:
        receiptOrigins.forumRoutedFixtureReceipts > 0,
      hasForumRoutedNonFixtureReceipt:
        receiptOrigins.forumRoutedNonFixtureReceipts > 0,
    },
    receiptOrigins,
    registry,
    ledger: {
      receipts: ledger.receipts.map(publicPlaybackReceipt),
    },
  };
}

export async function buildHealth(options: ProofPackOptions) {
  const [ledger, registry] = await Promise.all([
    readPlaybackLedger(options.ledgerPath),
    readCreatorRegistry(options.registryPath),
  ]);
  const verification = verifyPlaybackLedger(ledger);
  const hasForumRoutedReceipt = ledger.receipts.some(
    (receipt) => receipt.settlement.settlementMode === "forum-routed",
  );
  const receiptOrigins = summarizeReceiptOrigins(ledger);
  const proofStatus = statusForProof(options.feeRouterMode, receiptOrigins);

  return {
    ok: verification.ok,
    generatedAt: new Date().toISOString(),
    status: proofStatus.status,
    readiness: proofStatus.readiness,
    ledger: verification,
    registry: {
      videos: registry.videos.length,
    },
    settlement: {
      feeRouterMode: options.feeRouterMode,
      liveSpendEnabled: options.feeRouterMode === "live",
      hasForumRoutedReceipt,
      hasForumRoutedFixtureReceipt:
        receiptOrigins.forumRoutedFixtureReceipts > 0,
      hasForumRoutedNonFixtureReceipt:
        receiptOrigins.forumRoutedNonFixtureReceipts > 0,
    },
    receiptOrigins,
  };
}
