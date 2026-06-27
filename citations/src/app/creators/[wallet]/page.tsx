import Link from "next/link";
import { formatUsdc, shortHash, shortWallet } from "@/lib/format";
import { getCreatorEvidence, readLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ wallet: string }>;
};

function settlementLabel(mode: string): string {
  if (mode === "forum-routed") return "forum routed";
  if (mode === "x402-settled") return "x402 settled";
  if (mode === "x402-verified") return "x402 verified";
  return "local proof";
}

export default async function CreatorPage({ params }: Props) {
  const { wallet } = await params;
  const ledger = await readLedger();
  const creator = getCreatorEvidence(ledger, wallet);
  if (!creator) {
    return (
      <main className="shell receipt-page">
        <header className="receipt-header">
          <div>
            <p className="eyebrow">creator evidence</p>
            <h1>{shortWallet(wallet)}</h1>
          </div>
          <Link className="wallet-button receipt-back" href="/">
            Back to Tollgate
          </Link>
        </header>

        <section className="receipt-proof">
          <div className="signature-stat proof-stat">
            <span className="stat-label">earned from citations</span>
            <strong>{formatUsdc(0)}</strong>
            <span className="stat-unit">USDC</span>
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

  return (
    <main className="shell receipt-page">
      <header className="receipt-header">
        <div>
          <p className="eyebrow">creator evidence</p>
          <h1>{creator.creator}</h1>
        </div>
        <Link className="wallet-button receipt-back" href="/">
          Back to Tollgate
        </Link>
      </header>

      <section className="receipt-proof">
        <div className="signature-stat proof-stat">
          <span className="stat-label">earned from citations</span>
          <strong>{formatUsdc(creator.earnedAtomicUsdc)}</strong>
          <span className="stat-unit">USDC</span>
        </div>
        <div className="proof-copy">
          <p className="eyebrow">{creator.handle}</p>
          <h2>{shortWallet(creator.wallet)}</h2>
          <p className="hero-text">
            This public profile is generated from the append-only Tollgate
            ledger. Every amount below links back to the receipt and answer that
            caused the creator to earn.
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
        <div className="metric wide">
          <span>latest receipt</span>
          <strong>
            {latestReceipt ? shortHash(latestReceipt.receiptHash) : "none"}
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
                  {source.citationCount} citations /{" "}
                  {formatUsdc(source.earnedAtomicUsdc)} USDC
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
              <strong>{formatUsdc(receipt.amountAtomicUsdc)}</strong>
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
