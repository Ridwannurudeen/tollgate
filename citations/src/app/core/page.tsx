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

export default async function CorePage() {
  const [ledger, sources, aperture] = await Promise.all([
    readLedger(),
    readSources(),
    loadAperture(),
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

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell receipt-page" id="main">
        <header className="receipt-header">
          <div>
            <p className="eyebrow">tollgate · settlement core</p>
            <h1>One nanopayment rail. Three ways creators get paid.</h1>
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
              downloaded, and a PeerTube creator whose video is unlocked are
              paid by the exact same plumbing.
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
              <span>payout receipts</span>
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
              <span>total test USDC</span>
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
                <span>creators paid</span>
                <strong>{creators.length}</strong>
              </div>
              <div className="metric wide">
                <span>routed</span>
                <strong>{formatDollars(citationRouted)} USDC</strong>
              </div>
            </div>
            <p className="eyebrow">
              ledger {verification.ok ? "verified" : "needs attention"} ·{" "}
              {verification.receiptCount} receipts
            </p>
            <Link className="receipt-link" href="/">
              Open the citations app →
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
              Open the photo-licensing app →
            </Link>
          </article>

          <article className="integration-card">
            <div className="panel-heading">
              <p className="eyebrow">integration 03 · video</p>
              <h3>PeerTube plugin</h3>
            </div>
            <p className="hero-text">
              A permissionless PeerTube plugin gates video downloads and pays
              the creator per unlock with the same Arc USDC rail.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>package</span>
                <strong>peertube-plugin-tollgate</strong>
              </div>
              <div className="metric">
                <span>version</span>
                <strong>0.1.0</strong>
              </div>
              <div className="metric">
                <span>settlement</span>
                <strong>per download</strong>
              </div>
              <div className="metric wide">
                <span>proof</span>
                <strong>hash-chained receipts</strong>
              </div>
            </div>
            <p className="eyebrow">self-hosted PeerTube / Arc testnet</p>
            <Link className="receipt-link" href="/video">
              Open video licensing →
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
