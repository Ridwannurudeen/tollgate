import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUsdc, shortHash, shortWallet } from "@/lib/format";
import { readLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ hash: string }>;
};

function settlementLabel(mode: string): string {
  if (mode === "forum-routed") return "forum routed";
  if (mode === "x402-settled") return "x402 settled";
  if (mode === "x402-verified") return "x402 verified";
  return "local proof";
}

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
  const citation = query?.citations.find(
    (candidate) => candidate.sourceId === receipt.sourceId,
  );

  return (
    <main className="shell receipt-page">
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
        <EvidenceRow
          label="transaction"
          value={
            receipt.transaction
              ? shortHash(receipt.transaction)
              : "pending settlement"
          }
        />
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
      </section>

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
            </article>
          )}
        </section>
      )}
    </main>
  );
}
