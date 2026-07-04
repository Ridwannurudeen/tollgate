import Link from "next/link";
import {
  arcscanTxUrl,
  formatDollars,
  settlementLabel,
  shortHash,
  shortWallet,
} from "@/lib/format";
import type {
  AgentBudget,
  AgentStep,
  QueryRecord,
  SourceDecision,
} from "@/lib/types";

type Props = {
  query: QueryRecord | null;
  budget: AgentBudget | null;
  decisions: SourceDecision[];
  steps: AgentStep[];
};

export function LatestAnswer({ query, budget, decisions, steps }: Props) {
  return (
    <div className="answer-panel">
      <div className="panel-heading">
        <p className="eyebrow">latest answer</p>
        <h3>Attribution receipt</h3>
      </div>
      {query ? (
        <>
          <p className="answer-text">{query.answer}</p>
          <div className="receipt-grid">
            <div>
              <span>query hash</span>
              <strong>{shortHash(query.queryHash)}</strong>
              <Link className="receipt-link" href={`/answers/${query.id}`}>
                Open answer
              </Link>
            </div>
            <div>
              <span>answer hash</span>
              <strong>{shortHash(query.answerHash)}</strong>
            </div>
            <div>
              <span>paid citations</span>
              <strong>{query.citations.length}</strong>
            </div>
            <div>
              <span>total paid</span>
              <strong>{formatDollars(query.totalAtomicUsdc)}</strong>
            </div>
          </div>
          {query.readerPayment && (
            <div className="reader-payment-card">
              <div>
                <span>reader payment</span>
                <strong>
                  {settlementLabel(query.readerPayment.settlementMode)}
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
                <span>amount</span>
                <strong>
                  {formatDollars(query.readerPayment.amountAtomicUsdc)}
                </strong>
              </div>
              <div>
                <span>payment hash</span>
                <strong>
                  {query.readerPayment.transaction ? (
                    <a
                      className="receipt-link inline-link"
                      href={arcscanTxUrl(query.readerPayment.transaction)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {shortHash(query.readerPayment.paymentHash)}
                    </a>
                  ) : (
                    shortHash(query.readerPayment.paymentHash)
                  )}
                </strong>
              </div>
            </div>
          )}
          {steps.length > 0 && (
            <div className="decision-board">
              <div className="decision-summary">
                <div>
                  <span>agent mode</span>
                  <strong>
                    {query.agentMode === "llm"
                      ? "reasoning loop"
                      : "deterministic"}
                  </strong>
                </div>
                <div>
                  <span>steps</span>
                  <strong>{steps.length}</strong>
                </div>
              </div>
              <div className="decision-list">
                {steps.map((step) => (
                  <article className="decision-row selected" key={step.index}>
                    <div>
                      <strong>
                        {step.index + 1}. {step.name}
                      </strong>
                      <span>{step.summary}</span>
                    </div>
                    <small>{step.detail}</small>
                  </article>
                ))}
              </div>
            </div>
          )}
          {budget && decisions.length > 0 && (
            <div className="decision-board">
              <div className="decision-summary">
                <div>
                  <span>source budget</span>
                  <strong>
                    {formatDollars(budget.sourceBudgetAtomicUsdc)}
                  </strong>
                </div>
                <div>
                  <span>agent spent</span>
                  <strong>{formatDollars(budget.spentAtomicUsdc)}</strong>
                </div>
                <div>
                  <span>remaining</span>
                  <strong>{formatDollars(budget.remainingAtomicUsdc)}</strong>
                </div>
                <div>
                  <span>market sweep</span>
                  <strong>
                    {budget.purchasedCount}/{budget.candidateCount}
                  </strong>
                </div>
              </div>
              <div className="decision-list">
                {decisions.slice(0, 6).map((decision) => (
                  <article
                    className={
                      decision.selected
                        ? "decision-row selected"
                        : "decision-row"
                    }
                    key={decision.sourceId}
                  >
                    <div>
                      <strong>{decision.title}</strong>
                      <span>
                        {decision.creator} / score {decision.score} /{" "}
                        {formatDollars(decision.priceAtomicUsdc)}
                      </span>
                    </div>
                    <small>{decision.reason}</small>
                  </article>
                ))}
              </div>
            </div>
          )}
          <div className="citation-list">
            {query.citations.map((citation) => (
              <article className="citation-card" key={citation.sourceId}>
                <div>
                  <p>
                    <Link href={`/sources/${citation.sourceId}`}>
                      {citation.title}
                    </Link>
                  </p>
                  <span>
                    {citation.creator} /{" "}
                    {formatDollars(citation.amountAtomicUsdc)}
                  </span>
                </div>
                <small>{citation.reason}</small>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-state">
          <strong>No answer recorded yet.</strong>
          <span>
            Run a query to see the paid citations, answer hash, and receipt
            chain.
          </span>
        </div>
      )}
    </div>
  );
}
