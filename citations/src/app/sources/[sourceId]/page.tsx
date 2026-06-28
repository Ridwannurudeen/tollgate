import Link from "next/link";
import { notFound } from "next/navigation";
import { findSource } from "@/lib/catalog";
import { formatUsdc, shortHash, shortWallet } from "@/lib/format";
import { getSourceEvidence, readLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ sourceId: string }>;
};

function settlementLabel(mode: string): string {
  if (mode === "forum-routed") return "forum routed";
  if (mode === "x402-settled") return "x402 settled";
  if (mode === "x402-verified") return "x402 verified";
  return "local proof";
}

export default async function SourcePage({ params }: Props) {
  const { sourceId } = await params;
  const [ledger, source] = await Promise.all([
    readLedger(),
    findSource(sourceId),
  ]);
  if (!source) notFound();

  const evidence = getSourceEvidence(ledger, sourceId);
  const receipts = evidence?.receipts ?? [];
  const earnedAtomicUsdc = evidence?.earnedAtomicUsdc ?? 0;
  const latestReceipt = receipts[0];

  return (
    <main className="shell receipt-page">
      <header className="receipt-header">
        <div>
          <p className="eyebrow">source evidence</p>
          <h1>{source.title}</h1>
        </div>
        <Link className="wallet-button receipt-back" href="/">
          Back to Tollgate
        </Link>
      </header>

      <section className="receipt-proof">
        <div className="signature-stat proof-stat">
          <span className="stat-label">earned by source</span>
          <strong>{formatUsdc(earnedAtomicUsdc)}</strong>
          <span className="stat-unit">USDC</span>
        </div>
        <div className="proof-copy">
          <p className="eyebrow">{source.creator}</p>
          <h2>{source.handle}</h2>
          <p className="hero-text">{source.summary}</p>
          <p className="eyebrow">
            {source.verifiedCreator
              ? "verified owner"
              : source.sourceKind === "seed"
                ? "seed/demo source"
                : "unverified external source"}
          </p>
        </div>
      </section>

      <section className="evidence-grid">
        <div className="evidence-row">
          <span>priced endpoint</span>
          <strong>{`/api/sources/${source.id}`}</strong>
        </div>
        <div className="evidence-row">
          <span>price</span>
          <strong>{formatUsdc(source.priceAtomicUsdc)} USDC</strong>
        </div>
        <div className="evidence-row">
          <span>creator wallet</span>
          <strong>{shortWallet(source.wallet)}</strong>
        </div>
        <div className="evidence-row">
          <span>citations</span>
          <strong>{evidence?.citationCount ?? 0}</strong>
        </div>
        <div className="evidence-row">
          <span>latest receipt</span>
          <strong>
            {latestReceipt ? shortHash(latestReceipt.receiptHash) : "none"}
          </strong>
        </div>
        <div className="evidence-row">
          <span>source url</span>
          <strong>{source.url}</strong>
        </div>
        <div className="evidence-row">
          <span>source kind</span>
          <strong>{source.sourceKind}</strong>
        </div>
        <div className="evidence-row">
          <span>creator kind</span>
          <strong>{source.creatorKind}</strong>
        </div>
        <div className="evidence-row">
          <span>ownership proof</span>
          <strong>{source.ownershipProof?.method ?? "not verified"}</strong>
        </div>
        <div className="evidence-row">
          <span>verified at</span>
          <strong>{source.ownershipProof?.verifiedAt ?? "not verified"}</strong>
        </div>
      </section>

      <section className="receipt-context profile-section">
        <div className="panel-heading">
          <p className="eyebrow">registry tags</p>
          <h3>Pricing context</h3>
        </div>
        <div className="tag-list">
          {source.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </section>

      <section className="receipt-ledger">
        <div className="panel-heading">
          <p className="eyebrow">source receipts</p>
          <h3>Usage trail</h3>
        </div>
        {receipts.length > 0 ? (
          receipts.slice(0, 12).map((receipt) => (
            <article className="receipt-row" key={receipt.receiptHash}>
              <div>
                <strong>{receipt.creator}</strong>
                <span>
                  {settlementLabel(receipt.settlementMode)} /{" "}
                  {receipt.createdAt}
                </span>
                <span>
                  content {receipt.sourceContentHash
                    ? shortHash(receipt.sourceContentHash)
                    : "not recorded"}{" "}
                  / excerpt{" "}
                  {receipt.sourceExcerptHash
                    ? shortHash(receipt.sourceExcerptHash)
                    : "not recorded"}
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
          ))
        ) : (
          <div className="empty-state compact">
            <strong>No receipts yet.</strong>
            <span>Once an agent buys this source, receipts appear here.</span>
          </div>
        )}
      </section>
    </main>
  );
}
