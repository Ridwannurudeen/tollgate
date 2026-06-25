import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUsdc, shortHash, shortWallet } from "@/lib/format";
import { getAnswerEvidence, readLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ queryId: string }>;
};

function settlementLabel(mode: string): string {
  if (mode === "forum-routed") return "forum routed";
  if (mode === "x402-settled") return "x402 settled";
  if (mode === "x402-verified") return "x402 verified";
  return "local proof";
}

function arcscanTxUrl(tx: string): string {
  return `https://testnet.arcscan.app/tx/${tx}`;
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

export default async function AnswerPage({ params }: Props) {
  const { queryId } = await params;
  const ledger = await readLedger();
  const evidence = getAnswerEvidence(ledger, queryId);
  if (!evidence) notFound();

  const { query, receipts } = evidence;
  const receiptBySourceId = new Map(
    receipts.map((receipt) => [receipt.sourceId, receipt]),
  );
  const latestReceipt = receipts[0];
  const agentBudget = query.agentBudget;
  const sourceDecisions = query.sourceDecisions ?? [];
  const agentSteps = query.agentSteps ?? [];
  const agentModeLabel =
    query.agentMode === "llm"
      ? "agentic reasoning loop"
      : "deterministic policy";

  return (
    <main className="shell receipt-page">
      <header className="receipt-header">
        <div>
          <p className="eyebrow">answer evidence</p>
          <h1>{shortHash(query.answerHash)}</h1>
        </div>
        <Link className="wallet-button receipt-back" href="/">
          Back to Tollgate
        </Link>
      </header>

      <section className="receipt-proof">
        <div className="signature-stat proof-stat">
          <span className="stat-label">paid to cited sources</span>
          <strong>{formatUsdc(query.totalAtomicUsdc)}</strong>
          <span className="stat-unit">USDC</span>
        </div>
        <div className="proof-copy">
          <p className="eyebrow">
            {agentModeLabel} / {query.id}
          </p>
          <h2>{query.question}</h2>
          <p className="hero-text">{query.answer}</p>
        </div>
      </section>

      <section className="metrics-band profile-metrics">
        <div className="metric">
          <span>citations</span>
          <strong>{query.citations.length}</strong>
        </div>
        <div className="metric">
          <span>receipts</span>
          <strong>{receipts.length}</strong>
        </div>
        <div className="metric">
          <span>reader paid</span>
          <strong>
            {formatUsdc(query.readerPayment?.amountAtomicUsdc ?? 0)}
          </strong>
        </div>
        <div className="metric">
          <span>agent spent</span>
          <strong>{formatUsdc(agentBudget?.spentAtomicUsdc ?? 0)}</strong>
        </div>
        <div className="metric wide">
          <span>latest receipt</span>
          <strong>
            {latestReceipt ? shortHash(latestReceipt.receiptHash) : "none"}
          </strong>
        </div>
      </section>

      <section className="evidence-grid">
        <EvidenceRow label="query id" value={query.id} />
        <EvidenceRow label="query hash" value={query.queryHash} />
        <EvidenceRow label="answer hash" value={query.answerHash} />
        <EvidenceRow label="created at" value={query.createdAt} />
        <EvidenceRow label="receipt count" value={receipts.length} />
        <EvidenceRow
          label="reader payment hash"
          value={query.readerPayment?.paymentHash ?? "not reader-paid"}
        />
      </section>

      {query.readerPayment && (
        <section className="reader-payment-card receipt-payment-card">
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
        </section>
      )}

      {query.trackRecord && (
        <section className="receipt-context profile-section">
          <div className="panel-heading">
            <p className="eyebrow">Forum TrackRecordV2</p>
            <h3>On-chain attribution anchor</h3>
          </div>
          <div className="evidence-grid">
            <EvidenceRow label="bot id" value={query.trackRecord.botId} />
            <EvidenceRow label="sequence" value={query.trackRecord.seq} />
            <EvidenceRow
              label="record hash"
              value={query.trackRecord.recordHash}
            />
            <EvidenceRow
              label="evidence hash"
              value={query.trackRecord.evidenceHash}
            />
            <EvidenceRow
              label="evidence uri"
              value={query.trackRecord.evidenceUri}
            />
            <div className="evidence-row">
              <span>publish tx</span>
              <strong>
                <a
                  className="receipt-link inline-link"
                  href={arcscanTxUrl(query.trackRecord.transaction)}
                  rel="noreferrer"
                  target="_blank"
                >
                  {query.trackRecord.transaction}
                </a>
              </strong>
            </div>
          </div>
        </section>
      )}

      {agentBudget && sourceDecisions.length > 0 && (
        <section className="receipt-context profile-section">
          <div className="panel-heading">
            <p className="eyebrow">source market</p>
            <h3>Budgeted citation decision</h3>
          </div>
          <div className="decision-board">
            <div className="decision-summary">
              <div>
                <span>source budget</span>
                <strong>
                  {formatUsdc(agentBudget.sourceBudgetAtomicUsdc)}
                </strong>
              </div>
              <div>
                <span>agent spent</span>
                <strong>{formatUsdc(agentBudget.spentAtomicUsdc)}</strong>
              </div>
              <div>
                <span>remaining</span>
                <strong>{formatUsdc(agentBudget.remainingAtomicUsdc)}</strong>
              </div>
              <div>
                <span>market sweep</span>
                <strong>
                  {agentBudget.purchasedCount}/{agentBudget.candidateCount}
                </strong>
              </div>
            </div>
            <div className="decision-list">
              {sourceDecisions.map((decision) => (
                <article
                  className={
                    decision.selected ? "decision-row selected" : "decision-row"
                  }
                  key={decision.sourceId}
                >
                  <div>
                    <strong>{decision.title}</strong>
                    <span>
                      {decision.creator} / score {decision.score} /{" "}
                      {formatUsdc(decision.priceAtomicUsdc)} USDC
                    </span>
                  </div>
                  <small>{decision.reason}</small>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {agentSteps.length > 0 && (
        <section className="receipt-context profile-section">
          <div className="panel-heading">
            <p className="eyebrow">agent reasoning</p>
            <h3>How the agent reached this answer</h3>
          </div>
          {query.agentRationale && (
            <p className="hero-text">{query.agentRationale}</p>
          )}
          <div className="decision-list">
            {agentSteps.map((step) => (
              <article className="decision-row selected" key={step.index}>
                <div>
                  <strong>
                    {step.index + 1}. {step.name}
                  </strong>
                  <span>
                    {step.summary}
                    {step.spentAtomicUsdc !== undefined
                      ? ` / spent ${formatUsdc(step.spentAtomicUsdc)} USDC`
                      : ""}
                  </span>
                </div>
                <small>{step.detail}</small>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="lower-grid">
        <div className="creator-table">
          <div className="panel-heading">
            <p className="eyebrow">paid citations</p>
            <h3>Sources used</h3>
          </div>
          {query.citations.map((citation) => {
            const receipt = receiptBySourceId.get(citation.sourceId);
            return (
              <article
                className="citation-card receipt-citation"
                key={citation.sourceId}
              >
                <div>
                  <p>{citation.title}</p>
                  <span>
                    {citation.creator} / {formatUsdc(citation.amountAtomicUsdc)}{" "}
                    USDC
                  </span>
                  <small>{citation.reason}</small>
                </div>
                <div className="source-action">
                  <Link
                    className="receipt-link"
                    href={`/sources/${citation.sourceId}`}
                  >
                    Source page
                  </Link>
                  {receipt && (
                    <Link
                      className="receipt-link"
                      href={`/receipts/${receipt.receiptHash}`}
                    >
                      {shortHash(receipt.receiptHash)}
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="source-registry">
          <div className="panel-heading">
            <p className="eyebrow">answer receipts</p>
            <h3>Payment trail</h3>
          </div>
          {receipts.map((receipt) => (
            <article className="receipt-row" key={receipt.receiptHash}>
              <div>
                <strong>{receipt.creator}</strong>
                <span>
                  {settlementLabel(receipt.settlementMode)} /{" "}
                  {receipt.createdAt}
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
        </div>
      </section>
    </main>
  );
}
