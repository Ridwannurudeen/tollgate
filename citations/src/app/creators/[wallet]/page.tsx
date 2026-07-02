import Link from "next/link";
import { readFeeRouterClaimable } from "@/lib/fee-router";
import {
  arcscanTxUrl,
  formatDollars,
  settlementLabel,
  shortHash,
  shortWallet,
} from "@/lib/format";
import { getCreatorEvidence, readLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ wallet: string }>;
};

export default async function CreatorPage({ params }: Props) {
  const { wallet } = await params;
  const ledger = await readLedger();
  const creator = getCreatorEvidence(ledger, wallet);
  if (!creator) {
    return (
      <main className="shell receipt-page">
        <header className="receipt-header">
          <div>
            <p className="eyebrow">your earnings</p>
            <h1>{shortWallet(wallet)}</h1>
          </div>
          <Link className="wallet-button receipt-back" href="/">
            Back to Tollgate
          </Link>
        </header>

        <section className="receipt-proof">
          <div className="signature-stat proof-stat">
            <span className="stat-label">earned so far</span>
            <strong>{formatDollars(0)}</strong>
          </div>
          <div className="proof-copy">
            <h2>No earnings yet</h2>
            <p className="hero-text">
              This wallet has not been cited yet. Once Tollgate&apos;s agent
              cites a registered source paying this wallet, earnings and
              receipts will appear here automatically.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const latestReceipt = creator.receipts[0];
  const claimable = await readFeeRouterClaimable(creator.wallet).catch(
    () => null,
  );
  const latestRouteTx = creator.receipts.find(
    (receipt) => receipt.feeRouterPayTx,
  )?.feeRouterPayTx;

  return (
    <main className="shell receipt-page">
      <header className="receipt-header">
        <div>
          <p className="eyebrow">your earnings</p>
          <h1>{creator.creator}</h1>
        </div>
        <Link className="wallet-button receipt-back" href="/">
          Back to Tollgate
        </Link>
      </header>

      <section className="receipt-proof">
        <div className="signature-stat proof-stat">
          <span className="stat-label">earned so far</span>
          <strong>{formatDollars(creator.earnedAtomicUsdc)}</strong>
        </div>
        <div className="proof-copy">
          <p className="eyebrow">{creator.handle}</p>
          <h2>{shortWallet(creator.wallet)}</h2>
          <p className="hero-text">
            This is your public earnings page. Every amount links to the payment
            that created it, and you can withdraw any time.
          </p>
        </div>
      </section>

      <section className="metrics-band profile-metrics">
        <div className="metric">
          <span>sources cited</span>
          <strong>{creator.sourceCount}</strong>
        </div>
        <div className="metric">
          <span>paid citations</span>
          <strong>{creator.citationCount}</strong>
        </div>
        <div className="metric">
          <span>answers</span>
          <strong>{creator.queries.length}</strong>
        </div>
        <div className="metric">
          <span>available to withdraw</span>
          <strong>
            {claimable === null ? "—" : formatDollars(Number(claimable))}
          </strong>
        </div>
        <div className="metric wide">
          <span>latest receipt</span>
          <strong>
            {latestReceipt ? shortHash(latestReceipt.receiptHash) : "none"}
          </strong>
        </div>
      </section>

      <section className="evidence-grid">
        <div className="evidence-row">
          <span>total earned</span>
          <strong>{formatDollars(creator.earnedAtomicUsdc)}</strong>
        </div>
        <div className="evidence-row">
          <span>available to withdraw</span>
          <strong>
            {claimable === null ? "—" : formatDollars(Number(claimable))}
          </strong>
        </div>
        <div className="evidence-row">
          <span>payout wallet</span>
          <strong>{creator.wallet}</strong>
        </div>
        <div className="evidence-row">
          <span>latest payment</span>
          <strong>
            {latestRouteTx ? (
              <a
                className="receipt-link inline-link"
                href={arcscanTxUrl(latestRouteTx)}
                rel="noreferrer"
                target="_blank"
              >
                {shortHash(latestRouteTx)}
              </a>
            ) : (
              "not FeeRouter-routed"
            )}
          </strong>
        </div>
      </section>

      <section className="receipt-context profile-section">
        <div className="panel-heading">
          <p className="eyebrow">source mix</p>
          <h3>What earned</h3>
        </div>
        <div className="source-list">
          {creator.sources.map((source) => (
            <article className="source-card" key={source.sourceId}>
              <div>
                <p>{source.title}</p>
                <span>
                  {source.citationCount} citations ·{" "}
                  {formatDollars(source.earnedAtomicUsdc)}
                </span>
              </div>
              <Link
                className="receipt-link"
                href={`/sources/${source.sourceId}`}
              >
                View source
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="receipt-ledger">
        <div className="panel-heading">
          <p className="eyebrow">creator receipts</p>
          <h3>Payment trail</h3>
        </div>
        {creator.receipts.slice(0, 12).map((receipt) => (
          <article className="receipt-row" key={receipt.receiptHash}>
            <div>
              <strong>{receipt.sourceId}</strong>
              <span>
                {settlementLabel(receipt.settlementMode)} / {receipt.createdAt}
              </span>
            </div>
            <div className="numeric-cell">
              <strong>{formatDollars(receipt.amountAtomicUsdc)}</strong>
              <Link
                className="receipt-link"
                href={`/receipts/${receipt.receiptHash}`}
              >
                {shortHash(receipt.receiptHash)}
              </Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
