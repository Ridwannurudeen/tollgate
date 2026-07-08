import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { readSources } from "@/lib/catalog";
import { formatDollars } from "@/lib/format";
import {
  readLedger,
  summarizeCreators,
  verifyLedgerIntegrity,
} from "@/lib/ledger";

export const dynamic = "force-dynamic";

const FEE_ROUTER = "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59";
const ARC_EXPLORER = "https://testnet.arcscan.app";
const APERTURE_PROOF_URL = "https://tollgate.gudman.xyz/aperture/api/proof";
const PEERTUBE_PROOF_URL =
  "https://tollgate.gudman.xyz/plugins/tollgate/router/proof";
const JELLYFIN_PROOF_URL =
  process.env.JELLYFIN_PROOF_URL ??
  "https://tollgate.gudman.xyz/jellyfin/api/proof";
const WORDPRESS_PROOF_URL = "https://tollgate.gudman.xyz/api/wordpress/proof";

type ApertureProof = {
  verification: { ok: boolean; receiptCount: number; latestHash: string };
  totals: {
    receipts: number;
    registeredOwners: number;
    totalEarnedAtomicUsdc: number;
    licenseFeeAtomicUsdc: number;
  };
  settlement: { feeRouterEnabled: boolean };
  creators: {
    wallet: string;
    photographer: string;
    resolves: number;
    earned: number;
  }[];
};

type WordPressProof = {
  ledger: { valid: boolean; wordpressReceiptCount: number };
  receipts: { amountAtomicUsdc: number; settlementMode: string }[];
  queries: { id: string }[];
};

type PeerTubeProof = {
  status: string;
  publicPeerTubeInstanceMounted: boolean;
  publicInstanceStatus: string;
  plugin: {
    package: string;
    version: string;
    peerTube: string;
  };
  settlementRail: {
    feeRouterTxVerified: boolean;
  };
  localValidation: {
    routerProofValidated: boolean;
    pluginReceiptCountDuringLocalValidation: number;
  };
};

type JellyfinProof = {
  status: string;
  verification: { ok: boolean; receiptCount: number };
  totals: {
    receipts: number;
    registeredVideos: number;
    totalWatchedMinutes: number;
    totalAtomicUsdc: number;
  };
  settlement: {
    feeRouterMode: "dry-run" | "live";
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
};

async function loadAperture(): Promise<ApertureProof | null> {
  try {
    const res = await fetch(APERTURE_PROOF_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ApertureProof;
  } catch {
    return null;
  }
}

async function loadWordPress(): Promise<WordPressProof | null> {
  try {
    const res = await fetch(WORDPRESS_PROOF_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as WordPressProof;
  } catch {
    return null;
  }
}

async function loadPeerTube(): Promise<PeerTubeProof | null> {
  try {
    const res = await fetch(PEERTUBE_PROOF_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as PeerTubeProof;
  } catch {
    return null;
  }
}

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

export default async function CorePage() {
  const [ledger, sources, aperture, peertube, jellyfin, wordpress] =
    await Promise.all([
      readLedger(),
      readSources(),
      loadAperture(),
      loadPeerTube(),
      loadJellyfin(),
      loadWordPress(),
    ]);
  const creators = summarizeCreators(ledger);
  const verification = verifyLedgerIntegrity(ledger);
  const citationRouted = ledger.receipts.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );
  const paidQueries = ledger.queries.filter((query) => query.readerPayment);
  const uniquePayers = new Set(
    paidQueries
      .map((query) => query.readerPayment?.payer)
      .filter((payer): payer is string => Boolean(payer)),
  );
  const uniqueCreatorWallets = new Set(
    ledger.receipts.map((receipt) => receipt.wallet.toLowerCase()),
  );
  const wordpressRouted =
    wordpress?.receipts.reduce(
      (sum, receipt) => sum + receipt.amountAtomicUsdc,
      0,
    ) ?? 0;
  const wordpressSites = new Set(
    wordpress?.queries
      .map((query) => query.id.split(":")[1])
      .filter((siteId): siteId is string => Boolean(siteId)) ?? [],
  );
  const wordpressForumRouted =
    wordpress?.receipts.some(
      (receipt) => receipt.settlementMode === "forum-routed",
    ) ?? false;
  const peertubeVersion = peertube?.plugin.version ?? "0.1.0";
  const peertubePackage =
    peertube?.plugin.package ?? "peertube-plugin-tollgate";
  const jellyfinRouted = jellyfin?.totals.totalAtomicUsdc ?? 0;
  const jellyfinLiveWebhookReceipt =
    jellyfin?.settlement.hasForumRoutedNonFixtureReceipt ?? false;
  const jellyfinFixtureReplay =
    jellyfin?.settlement.hasForumRoutedFixtureReceipt ?? false;

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell receipt-page" id="main">
        <header className="receipt-header">
          <div>
            <p className="eyebrow">tollgate · settlement core</p>
            <h1>One nanopayment rail. Open-source communities get paid.</h1>
          </div>
          <Link className="wallet-button receipt-back" href="/">
            Citations app
          </Link>
        </header>

        <section className="receipt-proof">
          <div className="signature-stat proof-stat">
            <span className="stat-label">settled on</span>
            <strong>Arc</strong>
            <span className="stat-unit">USDC</span>
          </div>
          <div className="proof-copy">
            <p className="eyebrow">the core</p>
            <h2>Pay per use, on-chain, in fractions of a cent</h2>
            <p className="hero-text">
              Tollgate is a creator nanopayment settlement core on Arc. Every
              integration below settles through the same on-chain rail — the
              Forum FeeRouter at{" "}
              <a
                className="receipt-link"
                href={`${ARC_EXPLORER}/address/${FEE_ROUTER}`}
                target="_blank"
                rel="noreferrer"
              >
                {FEE_ROUTER}
              </a>{" "}
              — so a writer cited by an AI, a photographer whose photo is
              downloaded, an Immich or Jellyfin operator, a PeerTube creator
              whose video is unlocked, and a WordPress publisher whose post is
              opened can all attach to the same settlement plumbing.
            </p>
          </div>
        </section>

        <section className="receipt-proof">
          <div className="proof-copy">
            <p className="eyebrow">traction snapshot</p>
            <h2>Seed/demo activity is not counted as external traction</h2>
            <p className="hero-text">
              These counters are derived from the live local ledgers and source
              registry labels. Seed sources stay visible for demo
              reproducibility, but they are separated from external and
              internal-test sources.
            </p>
          </div>
          <div className="evidence-grid">
            <div className="evidence-row">
              <span>external sources</span>
              <strong>
                {
                  sources.filter((source) => source.sourceKind === "external")
                    .length
                }
              </strong>
            </div>
            <div className="evidence-row">
              <span>seed/demo sources</span>
              <strong>
                {
                  sources.filter((source) => source.sourceKind === "seed")
                    .length
                }
              </strong>
            </div>
            <div className="evidence-row">
              <span>internal-test sources</span>
              <strong>
                {
                  sources.filter(
                    (source) => source.sourceKind === "internal-test",
                  ).length
                }
              </strong>
            </div>
            <div className="evidence-row">
              <span>paid queries</span>
              <strong>{paidQueries.length}</strong>
            </div>
            <div className="evidence-row">
              <span>payment receipts</span>
              <strong>{ledger.receipts.length}</strong>
            </div>
            <div className="evidence-row">
              <span>unique payer wallets</span>
              <strong>{uniquePayers.size}</strong>
            </div>
            <div className="evidence-row">
              <span>unique creator wallets</span>
              <strong>{uniqueCreatorWallets.size}</strong>
            </div>
            <div className="evidence-row">
              <span>payments recorded</span>
              <strong>{formatDollars(citationRouted)} USDC</strong>
            </div>
          </div>
        </section>

        <section className="integration-grid">
          <article className="integration-card">
            <div className="panel-heading">
              <p className="eyebrow">integration 01 · publishers</p>
              <h3>Citations</h3>
            </div>
            <p className="hero-text">
              An answer agent buys the sources it cites and pays each creator
              per citation.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>answers</span>
                <strong>{ledger.queries.length}</strong>
              </div>
              <div className="metric">
                <span>receipts</span>
                <strong>{ledger.receipts.length}</strong>
              </div>
              <div className="metric">
                <span>paid creators</span>
                <strong>{creators.length}</strong>
              </div>
              <div className="metric wide">
                <span>payments recorded</span>
                <strong>{formatDollars(citationRouted)} USDC</strong>
              </div>
            </div>
            <p className="eyebrow">
              ledger {verification.ok ? "verified" : "needs attention"} ·{" "}
              {verification.receiptCount} receipts
            </p>
            <Link className="receipt-link" href="/register">
              Register a source →
            </Link>
          </article>

          <article className="integration-card">
            <div className="panel-heading">
              <p className="eyebrow">integration 02 · photographers</p>
              <h3>Photo licensing</h3>
            </div>
            <p className="hero-text">
              A sidecar on a self-hosted photo library pays the photographer
              each time a shared photo is downloaded.
            </p>
            {aperture ? (
              <>
                <div className="metrics-band profile-metrics">
                  <div className="metric">
                    <span>downloads paid</span>
                    <strong>{aperture.totals.receipts}</strong>
                  </div>
                  <div className="metric">
                    <span>photographers</span>
                    <strong>{aperture.creators.length}</strong>
                  </div>
                  <div className="metric">
                    <span>per download</span>
                    <strong>
                      {formatDollars(aperture.totals.licenseFeeAtomicUsdc)}
                    </strong>
                  </div>
                  <div className="metric wide">
                    <span>earned</span>
                    <strong>
                      {formatDollars(aperture.totals.totalEarnedAtomicUsdc)}{" "}
                      USDC
                    </strong>
                  </div>
                </div>
                <p className="eyebrow">
                  {aperture.settlement.feeRouterEnabled
                    ? "settling on-chain"
                    : "local-proof"}{" "}
                  · ledger {aperture.verification.ok ? "verified" : "issue"}
                </p>
              </>
            ) : (
              <p className="hero-text">Aperture stats unavailable.</p>
            )}
            <Link className="receipt-link" href="/aperture">
              List a photo or video →
            </Link>
          </article>

          <article className="integration-card">
            <div className="panel-heading">
              <p className="eyebrow">integration 03 · immich</p>
              <h3>Immich sidecar</h3>
            </div>
            <p className="hero-text">
              The original Aperture path watches Immich shared-link downloads
              and turns each archive download into a creator receipt.
            </p>
            {aperture ? (
              <>
                <div className="metrics-band profile-metrics">
                  <div className="metric">
                    <span>receipts</span>
                    <strong>{aperture.totals.receipts}</strong>
                  </div>
                  <div className="metric">
                    <span>asset owners</span>
                    <strong>{aperture.totals.registeredOwners}</strong>
                  </div>
                  <div className="metric">
                    <span>API path</span>
                    <strong>/immich/api</strong>
                  </div>
                  <div className="metric wide">
                    <span>payments recorded</span>
                    <strong>
                      {formatDollars(aperture.totals.totalEarnedAtomicUsdc)}{" "}
                      USDC
                    </strong>
                  </div>
                </div>
                <p className="eyebrow">
                  {aperture.settlement.feeRouterEnabled
                    ? "settling on-chain"
                    : "local-proof"}{" "}
                  · Tollgate-hosted API path
                </p>
              </>
            ) : (
              <p className="hero-text">Immich/Aperture stats unavailable.</p>
            )}
            <Link className="receipt-link" href="/immich/register">
              Install / connect Immich →
            </Link>
          </article>

          <article className="integration-card">
            <div className="panel-heading">
              <p className="eyebrow">integration 04 · video</p>
              <h3>PeerTube plugin</h3>
            </div>
            <p className="hero-text">
              A permissionless PeerTube plugin gates video downloads. This
              public page is a proof mirror for the validated Docker run and
              shared FeeRouter rail; no public PeerTube instance is mounted here
              yet.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>package</span>
                <strong title={peertubePackage}>published</strong>
              </div>
              <div className="metric">
                <span>version</span>
                <strong>{peertubeVersion}</strong>
              </div>
              <div className="metric">
                <span>public host</span>
                <strong>
                  {peertube?.publicPeerTubeInstanceMounted
                    ? "live"
                    : "not hosted"}
                </strong>
              </div>
              <div className="metric wide">
                <span>rail tx</span>
                <strong>
                  {peertube?.settlementRail.feeRouterTxVerified
                    ? "verified"
                    : "pending"}
                </strong>
              </div>
            </div>
            <p className="eyebrow">
              self-hosted PeerTube · published package · proof mirror
            </p>
            <Link className="receipt-link" href="/video/register">
              Install PeerTube plugin →
            </Link>
          </article>

          <article className="integration-card">
            <div className="panel-heading">
              <p className="eyebrow">integration 05 · jellyfin</p>
              <h3>Jellyfin sidecar</h3>
            </div>
            <p className="hero-text">
              A Jellyfin Webhook sidecar bills watched minutes, writes a
              hash-linked receipt, and routes the creator payout through the
              FeeRouter in live mode. The current public proof labels fixture
              replays separately from real Jellyfin plugin events.
            </p>
            {jellyfin ? (
              <>
                <div className="metrics-band profile-metrics">
                  <div className="metric">
                    <span>receipts</span>
                    <strong>{jellyfin.totals.receipts}</strong>
                  </div>
                  <div className="metric">
                    <span>videos</span>
                    <strong>{jellyfin.totals.registeredVideos}</strong>
                  </div>
                  <div className="metric">
                    <span>minutes</span>
                    <strong>{jellyfin.totals.totalWatchedMinutes}</strong>
                  </div>
                  <div className="metric wide">
                    <span>payments recorded</span>
                    <strong>{formatDollars(jellyfinRouted)} USDC</strong>
                  </div>
                </div>
                <p className="eyebrow">
                  {jellyfinLiveWebhookReceipt
                    ? "FeeRouter webhook receipt"
                    : jellyfinFixtureReplay
                      ? "fixture FeeRouter replay"
                      : jellyfin.status}{" "}
                  · ledger {jellyfin.verification.ok ? "verified" : "issue"}
                </p>
              </>
            ) : (
              <p className="hero-text">Jellyfin stats unavailable.</p>
            )}
            <Link className="receipt-link" href="/jellyfin/register">
              Connect Jellyfin server →
            </Link>
          </article>

          <article className="integration-card">
            <div className="panel-heading">
              <p className="eyebrow">integration 06 · wordpress</p>
              <h3>WordPress plugin</h3>
            </div>
            <p className="hero-text">
              A WordPress plugin gates selected posts, calls Tollgate's hosted
              settlement API, and records each paid read on the same Arc USDC
              rail.
            </p>
            {wordpress ? (
              <>
                <div className="metrics-band profile-metrics">
                  <div className="metric">
                    <span>plugin</span>
                    <strong>tollgate.zip</strong>
                  </div>
                  <div className="metric">
                    <span>paid reads</span>
                    <strong>{wordpress.ledger.wordpressReceiptCount}</strong>
                  </div>
                  <div className="metric">
                    <span>publisher sites</span>
                    <strong>{wordpressSites.size}</strong>
                  </div>
                  <div className="metric wide">
                    <span>payments recorded</span>
                    <strong>{formatDollars(wordpressRouted)} USDC</strong>
                  </div>
                </div>
                <p className="eyebrow">
                  upload zip + paste API key ·{" "}
                  {wordpressForumRouted ? "settling on-chain" : "local-proof"} ·
                  ledger {wordpress.ledger.valid ? "verified" : "issue"}
                </p>
              </>
            ) : (
              <p className="hero-text">WordPress stats unavailable.</p>
            )}
            <Link className="receipt-link" href="/wordpress/register">
              Register a WordPress site →
            </Link>
          </article>
        </section>

        <section className="receipt-proof">
          <div className="proof-copy">
            <p className="eyebrow">why one rail</p>
            <p className="hero-text">
              Subscriptions exist because the old per-event payment was too
              small to clear. Nanopayments on Arc remove that floor, so the real
              unit — a citation, a download — becomes sellable on its own. Build
              the settlement core once; attach it to any community that already
              has an audience.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
