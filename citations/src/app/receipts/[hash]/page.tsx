import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import {
  formatBudgetUtilization,
  queryPaymentEconomics,
} from "@/lib/economics";
import {
  arcscanTxUrl,
  formatUsdc,
  settlementLabel,
  shortHash,
  shortWallet,
} from "@/lib/format";
import { readLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ hash: string }>;
};

function EvidenceRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="evidence-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default async function ReceiptPage({ params }: Props) {
  const { hash } = await params;
  const ledger = await readLedger();
  const receipt = ledger.receipts.find(
    (candidate) => candidate.receiptHash === hash || candidate.id === hash,
  );
  if (!receipt) notFound();

  const query = ledger.queries.find(
    (candidate) => candidate.id === receipt.queryId,
  );
  const economics = query ? queryPaymentEconomics(query) : null;
  const citation = query?.citations.find(
    (candidate) => candidate.sourceId === receipt.sourceId,
  );
  const contributorRows =
    receipt.contributors?.map((contributor) => ({
      ...contributor,
      amountAtomicUsdc: Math.floor(
        (receipt.amountAtomicUsdc * contributor.shareBps) / 10_000,
      ),
    })) ?? [];

  return (
    <>
      <SiteNav />
      <main className="shell receipt-page" id="main">
      <header className="receipt-header">
        <div>
          <p className="eyebrow">receipt evidence</p>
          <h1>{shortHash(receipt.receiptHash)}</h1>
        </div>
        <Link className="wallet-button receipt-back" href="/">
          Back to Tollgate
        </Link>
      </header>

      <section className="receipt-proof">
        <div className="signature-stat proof-stat">
          <span className="stat-label">paid to creator</span>
          <strong>{formatUsdc(receipt.amountAtomicUsdc)}</strong>
          <span className="stat-unit">USDC</span>
        </div>
        <div className="proof-copy">
          <p className="eyebrow">{settlementLabel(receipt.settlementMode)}</p>
          <h2>{receipt.creator}</h2>
          <p className="hero-text">
            This receipt binds a source payment to the answer that used it. The
            previous hash links it into the append-only attribution ledger.
          </p>
        </div>
      </section>

      <section className="evidence-grid">
        <EvidenceRow
          label="payment status"
          value={settlementLabel(receipt.settlementMode)}
        />
        <EvidenceRow label="settlement mode" value={receipt.settlementMode} />
        <EvidenceRow
          label="amount"
          value={`${formatUsdc(receipt.amountAtomicUsdc)} USDC`}
        />
        <EvidenceRow label="receipt hash" value={receipt.receiptHash} />
        <EvidenceRow label="previous hash" value={receipt.previousHash} />
        <EvidenceRow label="query id" value={receipt.queryId} />
        <EvidenceRow label="source id" value={receipt.sourceId} />
        <EvidenceRow
          label="creator wallet"
          value={shortWallet(receipt.wallet)}
        />
        <EvidenceRow label="created at" value={receipt.createdAt} />
        <EvidenceRow
          label="payment resource"
          value={receipt.paymentResource ?? `/api/sources/${receipt.sourceId}`}
        />
        <EvidenceRow
          label="query payment hash"
          value={receipt.queryPaymentHash ?? "not reader-paid"}
        />
        <EvidenceRow label="payer" value={receipt.payer ?? "local proof"} />
        <div className="evidence-row">
          <span>Arc tx</span>
          <strong>
            {receipt.transaction ? (
              <a
                className="receipt-link inline-link"
                href={arcscanTxUrl(receipt.transaction)}
                rel="noreferrer"
                target="_blank"
              >
                {shortHash(receipt.transaction)}
              </a>
            ) : (
              "pending settlement"
            )}
          </strong>
        </div>
        <EvidenceRow
          label="FeeRouter split"
          value={receipt.feeRouterSplitId ?? "not FeeRouter-routed"}
        />
        <EvidenceRow
          label="FeeRouter createSplit"
          value={
            receipt.feeRouterCreateSplitTx
              ? shortHash(receipt.feeRouterCreateSplitTx)
              : "not FeeRouter-routed"
          }
        />
        <EvidenceRow
          label="FeeRouter pay"
          value={
            receipt.feeRouterPayTx
              ? shortHash(receipt.feeRouterPayTx)
              : "not FeeRouter-routed"
          }
        />
        <EvidenceRow
          label="contributors"
          value={
            contributorRows.length > 0
              ? `${contributorRows.length} split recipients`
              : "single recipient"
          }
        />
        <EvidenceRow
          label="canonical URL"
          value={receipt.canonicalUrl ?? citation?.url ?? "not recorded"}
        />
        <EvidenceRow
          label="content fetched at"
          value={receipt.contentFetchedAt ?? "not recorded"}
        />
        <EvidenceRow
          label="source content hash"
          value={receipt.sourceContentHash ?? "not recorded"}
        />
        <EvidenceRow
          label="source excerpt hash"
          value={receipt.sourceExcerptHash ?? "not recorded"}
        />
        <EvidenceRow
          label="ownership proof"
          value={receipt.ownershipProof?.method ?? "not verified"}
        />
        <EvidenceRow
          label="ownership signer"
          value={receipt.ownershipProof?.signer ?? "not verified"}
        />
      </section>

      {contributorRows.length > 0 && (
        <section className="receipt-context profile-section">
          <div className="panel-heading">
            <p className="eyebrow">split recipients</p>
            <h3>Contributor amounts</h3>
          </div>
          <div className="source-list">
            {contributorRows.map((contributor) => (
              <article className="source-card" key={contributor.wallet}>
                <div>
                  <p>{shortWallet(contributor.wallet)}</p>
                  <span>{contributor.shareBps} bps</span>
                </div>
                <strong>{formatUsdc(contributor.amountAtomicUsdc)} USDC</strong>
              </article>
            ))}
          </div>
        </section>
      )}

      {query && (
        <section className="receipt-context">
          <div className="panel-heading">
            <p className="eyebrow">answer context</p>
            <h3>{query.question}</h3>
          </div>
          <p className="answer-text">{query.answer}</p>
          <Link className="receipt-link" href={`/answers/${query.id}`}>
            Open answer evidence
          </Link>
          {query.readerPayment && (
            <div className="reader-payment-card receipt-payment-card">
              <div>
                <span>reader payment</span>
                <strong>
                  {settlementLabel(query.readerPayment.settlementMode)}
                </strong>
              </div>
              <div>
                <span>amount</span>
                <strong>
                  {formatUsdc(query.readerPayment.amountAtomicUsdc)} USDC
                </strong>
              </div>
              <div>
                <span>payer</span>
                <strong>
                  {query.readerPayment.payer
                    ? shortWallet(query.readerPayment.payer)
                    : "pending"}
                </strong>
              </div>
              <div>
                <span>payment hash</span>
                <strong>{shortHash(query.readerPayment.paymentHash)}</strong>
              </div>
              <div>
                <span>creator payouts</span>
                <strong>
                  {economics
                    ? `${formatUsdc(economics.creatorPayoutsAtomicUsdc)} USDC`
                    : "n/a"}
                </strong>
              </div>
              <div>
                <span>protocol retained</span>
                <strong>
                  {economics
                    ? `${formatUsdc(economics.protocolRetainedAtomicUsdc)} USDC`
                    : "n/a"}
                </strong>
              </div>
              <div>
                <span>budget utilization</span>
                <strong>
                  {economics ? formatBudgetUtilization(economics) : "n/a"}
                </strong>
              </div>
            </div>
          )}
          {citation && (
            <article className="citation-card receipt-citation">
              <div>
                <p>{citation.title}</p>
                <span>
                  {citation.creator} / {formatUsdc(citation.amountAtomicUsdc)}{" "}
                  USDC
                </span>
              </div>
              <small>{citation.reason}</small>
              <small>
                {citation.paidExcerpt ?? "No paid excerpt recorded."}
              </small>
            </article>
          )}
        </section>
      )}
      </main>
    </>
  );
}
