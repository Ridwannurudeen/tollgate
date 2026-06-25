import Link from "next/link";
import { formatUsdc } from "@/lib/format";
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
    const res = await fetch(APERTURE_PROOF_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as ApertureProof;
  } catch {
    return null;
  }
}

export default async function CorePage() {
  const ledger = await readLedger();
  const creators = summarizeCreators(ledger);
  const verification = verifyLedgerIntegrity(ledger);
  const citationRouted = ledger.receipts.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );
  const aperture = await loadAperture();

  return (
    <main className="shell receipt-page">
      <header className="receipt-header">
        <div>
          <p className="eyebrow">tollgate · settlement core</p>
          <h1>One nanopayment rail. Two ways creators get paid.</h1>
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
            integration below settles through the same on-chain rail — the Forum
            FeeRouter at{" "}
            <a
              className="receipt-link"
              href={`${ARC_EXPLORER}/address/${FEE_ROUTER}`}
            >
              {FEE_ROUTER}
            </a>{" "}
            — so a writer cited by an AI and a photographer whose photo is
            downloaded are paid by the exact same plumbing.
          </p>
        </div>
      </section>

      <section className="integration-grid">
        <article className="integration-card">
          <div className="panel-heading">
            <p className="eyebrow">integration 01 · publishers</p>
            <h3>Citations</h3>
          </div>
          <p className="hero-text">
            An answer agent buys the sources it cites and pays each creator per
            citation.
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
              <strong>{formatUsdc(citationRouted)} USDC</strong>
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
            A sidecar on a self-hosted photo library pays the photographer each
            time a shared photo is downloaded.
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
                    {formatUsdc(aperture.totals.licenseFeeAtomicUsdc)}
                  </strong>
                </div>
                <div className="metric wide">
                  <span>earned</span>
                  <strong>
                    {formatUsdc(aperture.totals.totalEarnedAtomicUsdc)} USDC
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
            <p className="hero-text">Live stats are warming up.</p>
          )}
          <Link className="receipt-link" href="/aperture">
            Open the photo-licensing app →
          </Link>
        </article>
      </section>

      <section className="receipt-proof">
        <div className="proof-copy">
          <p className="eyebrow">why one rail</p>
          <p className="hero-text">
            Subscriptions exist because the old per-event payment was too small
            to clear. Nanopayments on Arc remove that floor, so the real unit —
            a citation, a download — becomes sellable on its own. Build the
            settlement core once; attach it to any community that already has an
            audience.
          </p>
        </div>
      </section>
    </main>
  );
}
