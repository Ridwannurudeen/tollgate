import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { arcscanTxUrl, formatDollars } from "@/lib/format";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const JELLYFIN_PROOF_URL =
  process.env.JELLYFIN_PROOF_URL ??
  "https://tollgate.gudman.xyz/jellyfin/api/proof";

type JellyfinProof = {
  status: string;
  readiness: string;
  verification: { ok: boolean; receiptCount: number; latestHash: string };
  totals: {
    receipts: number;
    registeredVideos: number;
    totalWatchedMinutes: number;
    totalAtomicUsdc: number;
    defaultAtomicUsdcPerMinute: number;
  };
  settlement: {
    feeRouterMode: "dry-run" | "live";
    liveSpendEnabled: boolean;
    hasForumRoutedReceipt: boolean;
    hasForumRoutedFixtureReceipt?: boolean;
    hasForumRoutedNonFixtureReceipt?: boolean;
  };
  receiptOrigins?: {
    fixtureReplayReceipts: number;
    nonFixtureReceipts: number;
    forumRoutedFixtureReceipts: number;
    forumRoutedNonFixtureReceipts: number;
    note: string;
  };
  ledger: {
    receipts: {
      itemName: string;
      watchedMinutes: number;
      amountAtomicUsdc: number;
      settlement: {
        settlementMode: string;
        feeRouterPayTx?: string;
        transaction?: string;
      };
    }[];
  };
};

async function loadJellyfin(): Promise<JellyfinProof | null> {
  try {
    const res = await fetch(JELLYFIN_PROOF_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as JellyfinProof;
  } catch {
    return null;
  }
}

export default async function JellyfinPage() {
  const [ledger, proof] = await Promise.all([readLedger(), loadJellyfin()]);
  const verification = verifyLedgerIntegrity(ledger);
  const latestReceipt = proof?.ledger.receipts.at(-1);
  const latestTx =
    latestReceipt?.settlement.feeRouterPayTx ??
    latestReceipt?.settlement.transaction ??
    null;
  const realWebhookReceipt =
    proof?.settlement.hasForumRoutedNonFixtureReceipt ?? false;
  const fixtureReplay = proof?.settlement.hasForumRoutedFixtureReceipt ?? false;

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell receipt-page" id="main">
        <header className="receipt-header">
          <div>
            <p className="eyebrow">jellyfin vod sidecar</p>
            <h1>Jellyfin watch time can settle per minute.</h1>
          </div>
          <Link className="wallet-button receipt-back" href="/core">
            Settlement core
          </Link>
        </header>

        <section className="receipt-proof">
          <div className="signature-stat proof-stat">
            <span className="stamp">Jellyfin</span>
            <span className="stat-label">proof status</span>
            <strong>{proof?.status ?? "unavailable"}</strong>
            <span className="stat-unit">
              {proof?.settlement.feeRouterMode ?? "offline"}
            </span>
          </div>
          <div className="proof-copy">
            <p className="eyebrow">integration 05 / video-on-demand</p>
            <h2>PlaybackStop events become hash-linked payout receipts.</h2>
            <p className="hero-text">
              A Jellyfin Webhook sidecar maps media item IDs to creator wallets,
              computes billable watched minutes, and routes each paid stop event
              through the Forum FeeRouter when live mode is enabled. The current
              public receipt is a fixture webhook replay; a real Jellyfin
              Webhook plugin event is still pending.
            </p>
          </div>
        </section>

        <section className="metrics-band profile-metrics">
          <div className="metric">
            <span>receipts</span>
            <strong>{proof?.totals.receipts ?? 0}</strong>
          </div>
          <div className="metric">
            <span>registered videos</span>
            <strong>{proof?.totals.registeredVideos ?? 0}</strong>
          </div>
          <div className="metric">
            <span>watched minutes</span>
            <strong>{proof?.totals.totalWatchedMinutes ?? 0}</strong>
          </div>
          <div className="metric wide">
            <span>payments recorded</span>
            <strong>
              {formatDollars(proof?.totals.totalAtomicUsdc ?? 0)} USDC
            </strong>
          </div>
        </section>

        <section className="evidence-grid">
          <div className="evidence-row">
            <span>public proof</span>
            <strong>
              <a href="/jellyfin/api/proof">/jellyfin/api/proof</a>
            </strong>
          </div>
          <div className="evidence-row">
            <span>readiness</span>
            <strong>{proof?.readiness ?? "sidecar proof unavailable"}</strong>
          </div>
          <div className="evidence-row">
            <span>receipt source</span>
            <strong>
              {proof?.receiptOrigins?.note ?? "proof unavailable"}
            </strong>
          </div>
          <div className="evidence-row">
            <span>ledger integrity</span>
            <strong>
              {proof?.verification.ok ? "verified" : "unavailable"} ·{" "}
              {proof?.verification.receiptCount ?? 0} receipts
            </strong>
          </div>
          <div className="evidence-row">
            <span>live settlement</span>
            <strong>
              {realWebhookReceipt
                ? "FeeRouter receipt from real webhook payload"
                : fixtureReplay
                  ? "FeeRouter receipt from fixture replay"
                  : "waiting for a live FeeRouter receipt"}
            </strong>
          </div>
          <div className="evidence-row">
            <span>latest FeeRouter tx</span>
            <strong>
              {latestTx ? (
                <a
                  href={arcscanTxUrl(latestTx)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {latestTx}
                </a>
              ) : (
                "none yet"
              )}
            </strong>
          </div>
        </section>
      </main>
    </>
  );
}
