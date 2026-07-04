import Link from "next/link";
import { CountUpNumber } from "@/components/CountUpNumber";
import { EarningsBoard } from "@/components/EarningsBoard";
import { LegacyHashRedirect } from "@/components/LegacyHashRedirect";
import { ReceiptTicker } from "@/components/ReceiptTicker";
import { formatDollars, shortHash } from "@/lib/format";
import { verifiedExternalCreatorSources } from "@/lib/first-load";
import type { CreatorEarnings, CreatorSource, Ledger } from "@/lib/types";

type Props = {
  sources: CreatorSource[];
  ledger: Ledger;
  creators: CreatorEarnings[];
};

function totalPaid(ledger: Ledger): number {
  return ledger.queries.reduce((sum, query) => sum + query.totalAtomicUsdc, 0);
}

function totalReaderPaid(ledger: Ledger): number {
  return ledger.queries.reduce(
    (sum, query) => sum + (query.readerPayment?.amountAtomicUsdc ?? 0),
    0,
  );
}

function latestHash(ledger: Ledger): string {
  return ledger.receipts.at(-1)?.receiptHash ?? `0x${"0".repeat(64)}`;
}

export function LandingPage({ sources, ledger, creators }: Props) {
  const externalCreators = verifiedExternalCreatorSources(sources);
  const stats = {
    totalPaid: totalPaid(ledger),
    readerPaid: totalReaderPaid(ledger),
    queryCount: ledger.queries.length,
    receiptCount: ledger.receipts.length,
    creatorCount: creators.length,
    sourceCount: sources.length,
    latestHash: latestHash(ledger),
  };

  return (
    <main className="shell landing-shell" id="main">
      <LegacyHashRedirect />
      <section className="landing-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">AI citation payments on Arc</p>
          <h1 id="hero-title">Tollgate</h1>
          <p className="hero-text">
            Writers, publishers, and researchers register priced work. When an
            answer agent cites it, the creator gets paid in USDC and the receipt
            becomes public proof.
          </p>
          <div className="hero-cta">
            <Link className="cta-primary" href="/register">
              Register your work
            </Link>
            <Link className="cta-secondary" href="/ask">
              Ask the AI
            </Link>
          </div>
        </div>
        <div className="hero-stat-column">
          <div className="signature-stat receipt-printer" aria-live="polite">
            <span className="stat-label">citation payments made</span>
            <strong>
              <CountUpNumber value={stats.receiptCount} />
            </strong>
            <div className="receipt-lines">
              <span className="receipt-line">
                creators paid <strong>{stats.creatorCount}</strong>
              </span>
              <span className="receipt-line">
                routed to creators{" "}
                <strong>{formatDollars(stats.totalPaid)}</strong>
              </span>
              <span className="receipt-line">
                latest hash <strong>{shortHash(stats.latestHash)}</strong>
              </span>
            </div>
            <span className="stamp" aria-hidden="true">
              paid - on-chain
            </span>
          </div>
        </div>
      </section>

      <ReceiptTicker receipts={ledger.receipts} />

      <section className="how-it-works landing-how" id="how">
        <div className="section-heading">
          <p className="eyebrow">how it works</p>
          <h2>Three steps from registered work to provable payout</h2>
        </div>
        <ol className="step-grid">
          <li className="step-card">
            <span className="step-index" aria-hidden="true">
              01
            </span>
            <span className="step-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </span>
            <h3>Register priced work</h3>
            <p>
              Add an article, feed post, or reference page with a per-citation
              price and payout wallet.
            </p>
          </li>
          <li className="step-card">
            <span className="step-index" aria-hidden="true">
              02
            </span>
            <span className="step-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 7h16M4 12h10M4 17h7" />
                <path d="M17 14l3 3-3 3" />
              </svg>
            </span>
            <h3>The agent buys citations</h3>
            <p>
              The answer workbench appraises registered sources, spends a small
              budget, and grounds the answer in paid material.
            </p>
          </li>
          <li className="step-card">
            <span className="step-index" aria-hidden="true">
              03
            </span>
            <span className="step-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 7H5a2 2 0 0 1 0-4h13v4" />
                <path d="M4 6v12a2 2 0 0 0 2 2h14v-8" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
              </svg>
            </span>
            <h3>Receipts prove payment</h3>
            <p>
              Each payout links the answer, source, wallet, amount, and ledger
              hash into a public evidence trail.
            </p>
          </li>
        </ol>
      </section>

      <section className="landing-traction" aria-label="Live traction">
        <div>
          <p className="eyebrow">live traction</p>
          <h2>Creator earnings are visible before the pitch deck</h2>
          <p className="hero-text">
            The homepage now shows the network heartbeat and sends operators to
            the dedicated workbench routes instead of burying every action in
            one long page.
          </p>
        </div>
        <div className="metrics-band profile-metrics">
          <div className="metric">
            <span>answers</span>
            <strong>{stats.queryCount}</strong>
          </div>
          <div className="metric">
            <span>receipts</span>
            <strong>{stats.receiptCount}</strong>
          </div>
          <div className="metric">
            <span>reader paid</span>
            <strong>{formatDollars(stats.readerPaid)}</strong>
          </div>
          <div className="metric">
            <span>priced sources</span>
            <strong>{stats.sourceCount}</strong>
          </div>
        </div>
      </section>

      {externalCreators.length > 0 && (
        <section
          className="external-strip"
          aria-label="Verified external creators"
        >
          <div className="external-strip-heading">
            <p className="eyebrow">verified external creators</p>
            <strong>{externalCreators.length}/3 live sources</strong>
          </div>
          <div className="external-strip-list">
            {externalCreators.map((source) => (
              <Link
                className="external-creator-link"
                href={`/sources/${source.id}`}
                key={source.id}
              >
                <span>{source.creator}</span>
                <strong>{source.title}</strong>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="landing-integrations" aria-label="Integrations">
        <article className="integration-card">
          <div className="panel-heading">
            <p className="eyebrow">publishers</p>
            <h3>Citations</h3>
          </div>
          <p className="hero-text">
            AI answer agents pay writers and research sources per cited answer.
          </p>
          <Link className="receipt-link" href="/ask">
            Open the workbench
          </Link>
        </article>
        <article className="integration-card">
          <div className="panel-heading">
            <p className="eyebrow">media</p>
            <h3>Aperture</h3>
          </div>
          <p className="hero-text">
            The same settlement core pays photographers for licensed downloads.
          </p>
          <Link className="receipt-link" href="/core">
            See the core
          </Link>
        </article>
        <article className="integration-card">
          <div className="panel-heading">
            <p className="eyebrow">video</p>
            <h3>PeerTube</h3>
          </div>
          <p className="hero-text">
            A self-hosted video plugin gates downloads and routes USDC to the
            creator per unlock.
          </p>
          <Link className="receipt-link" href="/video">
            View video licensing
          </Link>
        </article>
      </section>

      <section className="landing-proof-band">
        <div>
          <p className="eyebrow">proof surface</p>
          <h2>Every claim links to receipts, hashes, and creator pages</h2>
        </div>
        <div className="hero-cta">
          <Link className="cta-primary" href="/proof">
            Open proof
          </Link>
          <Link className="cta-secondary" href="/creators">
            View creators
          </Link>
        </div>
      </section>

      <section className="landing-board">
        <EarningsBoard creators={creators} limit={5} />
      </section>

      <section className="landing-final-cta">
        <p className="eyebrow">start here</p>
        <h2>Register one priced source, then ask the agent to cite it.</h2>
        <div className="hero-cta">
          <Link className="cta-primary" href="/register">
            Register your work
          </Link>
          <Link className="cta-secondary" href="/ask">
            Run the demo
          </Link>
        </div>
      </section>
    </main>
  );
}
