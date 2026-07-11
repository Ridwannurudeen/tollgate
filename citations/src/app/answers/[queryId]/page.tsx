import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/SiteNav";
import {
  formatBudgetUtilization,
  queryPaymentEconomics,
} from "@/lib/economics";
import { agentServerModeFromEnv } from "@/lib/agent";
import { readCovenantEnvelope } from "@/lib/covenant";
import {
  arcscanTxUrl,
  formatAtomicUsdc,
  formatUsdc,
  settlementLabel,
  shortHash,
  shortWallet,
} from "@/lib/format";
import {
  getAnswerEvidence,
  readLedger,
  verifyLedgerIntegrity,
} from "@/lib/ledger";
import { agentTraceLabel, displayAgentRationale } from "@/lib/query-display";
import { sourceStatus } from "@/lib/source-status";
import { readCachedSlashBondStatus } from "@/lib/slash-bond";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ queryId: string }>;
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

export default async function AnswerPage({ params }: Props) {
  const { queryId } = await params;
  const [ledger, covenant, slashBond] = await Promise.all([
    readLedger(),
    readCovenantEnvelope().catch(() => null),
    readCachedSlashBondStatus().catch(() => null),
  ]);
  const verification = verifyLedgerIntegrity(ledger);
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
  const externalAssists = query.externalAssists ?? [];
  const claimSupport = query.claimSupport ?? [];
  const contributionScores = query.contributionScores ?? [];
  const contributionBySourceId = new Map(
    contributionScores.map((score) => [score.sourceId, score]),
  );
  const economics = queryPaymentEconomics(query);
  const latestChainHash = receipts.at(-1)?.receiptHash ?? "none";
  const refundSummary = query.refundSummary ?? {
    boughtCount: query.citations.length,
    citedCount: query.citations.filter(
      (citation) => citation.payoutPolicy !== "refund-unused",
    ).length,
    refundedCount: receipts.filter(
      (receipt) => receipt.settlementMode === "refunded",
    ).length,
    refundedAtomicUsdc: receipts
      .filter((receipt) => receipt.settlementMode === "refunded")
      .reduce((sum, receipt) => sum + receipt.amountAtomicUsdc, 0),
  };
  const displayedRationale = displayAgentRationale(query.agentRationale);
  const serverAgentMode = agentServerModeFromEnv();
  const agentModeLabel =
    query.agentMode === "llm"
      ? "agentic reasoning loop"
      : query.agentMode === "deterministic"
        ? "deterministic policy"
        : "agent mode not recorded";

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell receipt-page" id="main">
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
            <span className="stat-label">citation payments recorded</span>
            <strong>{formatUsdc(query.totalAtomicUsdc)}</strong>
            <span className="stat-unit">USDC</span>
          </div>
          <div className="proof-copy">
            <p className="eyebrow">
              {agentModeLabel} / server {serverAgentMode} / {query.id}
            </p>
            <h2>{query.question}</h2>
            <p className="hero-text">{query.answer}</p>
            <p className="status-line">
              {refundSummary.boughtCount} sources bought /{" "}
              {refundSummary.citedCount} cited / {refundSummary.refundedCount}{" "}
              refunded
            </p>
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
            <strong>{formatUsdc(economics.readerPaidAtomicUsdc)}</strong>
          </div>
          <div className="metric">
            <span>creator payouts (reader-paid)</span>
            <strong>{formatUsdc(economics.creatorPayoutsAtomicUsdc)}</strong>
          </div>
          <div className="metric">
            <span>protocol retained (reader-paid)</span>
            <strong>
              {query.readerPayment
                ? formatUsdc(economics.protocolRetainedAtomicUsdc)
                : "not reader-paid"}
            </strong>
          </div>
          <div className="metric">
            <span>budget utilization</span>
            <strong>
              {query.readerPayment ? formatBudgetUtilization(economics) : "n/a"}
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
          <EvidenceRow label="query id" value={query.id} />
          <EvidenceRow label="query hash" value={query.queryHash} />
          <EvidenceRow label="answer hash" value={query.answerHash} />
          <EvidenceRow label="created at" value={query.createdAt} />
          <EvidenceRow
            label="record agent mode"
            value={query.agentMode ?? "not recorded"}
          />
          <EvidenceRow
            label="agent model"
            value={query.agentModel ?? "not recorded"}
          />
          <EvidenceRow label="server agent mode" value={serverAgentMode} />
          <EvidenceRow label="receipt count" value={receipts.length} />
          <EvidenceRow
            label="reader payment hash"
            value={query.readerPayment?.paymentHash ?? "not reader-paid"}
          />
          <EvidenceRow
            label="reader paid"
            value={`${formatUsdc(economics.readerPaidAtomicUsdc)} USDC`}
          />
          <EvidenceRow
            label="creator payouts (reader-paid)"
            value={`${formatUsdc(economics.creatorPayoutsAtomicUsdc)} USDC`}
          />
          <EvidenceRow
            label="protocol retained (reader-paid)"
            value={
              query.readerPayment
                ? `${formatUsdc(economics.protocolRetainedAtomicUsdc)} USDC`
                : "not reader-paid"
            }
          />
          <EvidenceRow
            label="budget utilization"
            value={
              query.readerPayment ? formatBudgetUtilization(economics) : "n/a"
            }
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
            {query.readerPayment.refund && (
              <div>
                <span>refunded — no source to cite</span>
                <strong>
                  <a
                    className="receipt-link inline-link"
                    href={arcscanTxUrl(query.readerPayment.refund.transaction)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {formatUsdc(query.readerPayment.refund.amountAtomicUsdc)}{" "}
                    USDC returned
                  </a>
                </strong>
              </div>
            )}
          </section>
        )}

        {agentBudget && (
          <section className="receipt-context profile-section">
            <div className="panel-heading">
              <p className="eyebrow">agent accountability</p>
              <h3>Budget envelope and proof anchors</h3>
            </div>
            <div className="evidence-grid">
              <EvidenceRow
                label="budget envelope"
                value={`${formatUsdc(agentBudget.sourceBudgetAtomicUsdc)} USDC`}
              />
              <EvidenceRow
                label="spent on sources"
                value={`${formatUsdc(agentBudget.spentAtomicUsdc)} USDC`}
              />
              <EvidenceRow
                label="unused"
                value={`${formatUsdc(agentBudget.remainingAtomicUsdc)} USDC`}
              />
              <EvidenceRow
                label="source cap"
                value={`${agentBudget.purchasedCount}/${agentBudget.candidateCount} bought`}
              />
              <EvidenceRow
                label="covenant policy"
                value={
                  covenant?.latestVault
                    ? `${formatAtomicUsdc(
                        covenant.latestVault.mandate.budgetUsdc,
                      )} USDC max`
                    : "not published locally"
                }
              />
              <EvidenceRow
                label="allowed domains"
                value="registered source URLs only"
              />
              <EvidenceRow
                label="TrackRecord anchor"
                value={
                  query.trackRecord
                    ? shortHash(query.trackRecord.recordHash)
                    : "none"
                }
              />
              <EvidenceRow
                label="SlashBond status"
                value={
                  slashBond
                    ? `${formatAtomicUsdc(slashBond.bondBalance)} USDC bonded`
                    : "not published locally"
                }
              />
              <EvidenceRow label="receipt chain hash" value={latestChainHash} />
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

        {query.useIntent && (
          <section className="receipt-context profile-section">
            <div className="panel-heading">
              <p className="eyebrow">EIP-712 TollgateUseIntent</p>
              <h3>Signed decision-to-spend anchor</h3>
            </div>
            <div className="evidence-grid">
              <EvidenceRow label="intent digest" value={query.useIntent.digest} />
              <EvidenceRow
                label="signature"
                value={query.useIntent.signature}
              />
              <EvidenceRow
                label="max spend"
                value={`${formatUsdc(Number(query.useIntent.maxSpendAtomicUsdc))} USDC`}
              />
              <EvidenceRow label="nonce" value={query.useIntent.nonce} />
              <EvidenceRow label="expiry" value={query.useIntent.expiry} />
              <EvidenceRow
                label="candidate set root"
                value={query.useIntent.candidateSetRoot}
              />
              <EvidenceRow
                label="selected sources root"
                value={query.useIntent.selectedSourcesRoot}
              />
              <EvidenceRow
                label="decision trace hash"
                value={query.useIntent.decisionTraceHash}
              />
              <EvidenceRow
                label="claim support root"
                value={query.useIntent.claimSupportRoot}
              />
              <div className="evidence-row">
                <span>Arc anchor tx</span>
                <strong>
                  <a
                    className="receipt-link inline-link"
                    href={arcscanTxUrl(query.useIntent.anchorTx)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {query.useIntent.anchorTx}
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
          <section className="receipt-context profile-section agent-trace">
            <div className="panel-heading">
              <p className="eyebrow">
                agent reasoning / {agentTraceLabel(query)}
              </p>
              <h3>Appraise to payout timeline</h3>
            </div>
            {displayedRationale && (
              <p className="hero-text">{displayedRationale}</p>
            )}
            {externalAssists.length > 0 && (
              <p className="status-line">
                external assist:{" "}
                {externalAssists
                  .map(
                    (assist) =>
                      `${assist.provider} / ${formatUsdc(
                        assist.amountAtomicUsdc,
                      )} USDC / ${shortHash(assist.transaction)}`,
                  )
                  .join(", ")}
              </p>
            )}
            <ol className="trace-list">
              {agentSteps.map((step) => (
                <li className="trace-step" key={step.index}>
                  <span className="trace-num">{step.index + 1}</span>
                  <div className="trace-body">
                    <strong>{step.name}</strong>
                    <span className="trace-summary">
                      {step.summary}
                      {step.spentAtomicUsdc !== undefined
                        ? ` · spent ${formatUsdc(step.spentAtomicUsdc)} USDC`
                        : ""}
                    </span>
                    <small>{step.detail}</small>
                  </div>
                </li>
              ))}
              <li className="trace-step">
                <span className="trace-num">{agentSteps.length + 1}</span>
                <div className="trace-body">
                  <strong>final</strong>
                  <span className="trace-summary">
                    Final answer is restricted to paid citation records.
                  </span>
                  <small>
                    {query.citations.length > 0
                      ? query.citations
                          .map((citation) => citation.title)
                          .join(", ")
                      : "No source citations were bought."}
                  </small>
                </div>
              </li>
              <li className="trace-step">
                <span className="trace-num">{agentSteps.length + 2}</span>
                <div className="trace-body">
                  <strong>receipts</strong>
                  <span className="trace-summary">
                    Wrote {receipts.length} source payment receipt
                    {receipts.length === 1 ? "" : "s"} into the ledger.
                  </span>
                  <small>{latestChainHash}</small>
                </div>
              </li>
            </ol>
          </section>
        )}

        {claimSupport.length > 0 && (
          <section className="receipt-context profile-section">
            <div className="panel-heading">
              <p className="eyebrow">proof of useful citation</p>
              <h3>Claim support and contribution payout</h3>
            </div>
            <div className="decision-list">
              {claimSupport.map((support, index) => {
                const score = support.sourceId
                  ? contributionBySourceId.get(support.sourceId)
                  : undefined;
                return (
                  <article
                    className={
                      support.status === "supported"
                        ? "decision-row selected"
                        : "decision-row"
                    }
                    key={support.claim + index}
                  >
                    <div>
                      <strong>{support.claim}</strong>
                      <span>
                        {support.status} / source {support.sourceId ?? "none"}
                      </span>
                    </div>
                    <small>
                      span: {support.span ?? "not verified"} / marginal
                      contribution {score?.marginalContribution ?? 0} / payout{" "}
                      {formatUsdc(score?.rewardAtomicUsdc ?? 0)} USDC
                    </small>
                  </article>
                );
              })}
            </div>
            {query.claimSupportRoot && (
              <p className="status-line">
                claim support root {shortHash(query.claimSupportRoot)}
              </p>
            )}
          </section>
        )}

        <section className="lower-grid">
          <div className="creator-table">
            <div className="panel-heading">
              <p className="eyebrow">paid citations</p>
              <h3>Sources used</h3>
            </div>
            {query.citations.length > 0 ? (
              query.citations.map((citation) => {
                const receipt = receiptBySourceId.get(citation.sourceId);
                const status = sourceStatus({
                  sourceKind: citation.sourceKind,
                  creatorKind: citation.creatorKind,
                  verifiedCreator: citation.verifiedCreator,
                  creatorClaimed: citation.creatorClaimed,
                });
                return (
                  <article
                    className="citation-card receipt-citation"
                    key={citation.sourceId}
                  >
                    <div>
                      <p>{citation.title}</p>
                      <span>
                        {citation.creator} /{" "}
                        {formatUsdc(citation.amountAtomicUsdc)} USDC
                      </span>
                      <small>
                        {status.label} / {status.detail} / excerpt{" "}
                        {citation.sourceExcerptHash
                          ? shortHash(citation.sourceExcerptHash)
                          : "not recorded"}
                      </small>
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
              })
            ) : (
              <div className="empty-state compact">
                <strong>No citations bought.</strong>
                <span>
                  No registered source covered the question, so no creator was
                  paid.
                </span>
              </div>
            )}
          </div>

          <div className="source-registry">
            <div className="panel-heading">
              <p className="eyebrow">answer receipts</p>
              <h3>Payment trail</h3>
            </div>
            {receipts.length > 0 ? (
              receipts.map((receipt) => (
                <article className="receipt-row" key={receipt.receiptHash}>
                  <div>
                    <strong>{receipt.creator}</strong>
                    <span>
                      payment status: {settlementLabel(receipt.settlementMode)}{" "}
                      / creator recipient {shortWallet(receipt.wallet)}
                    </span>
                    <span>
                      ledger {shortHash(receipt.receiptHash)} / prev{" "}
                      {shortHash(receipt.previousHash)}
                    </span>
                  </div>
                  <div className="numeric-cell">
                    <strong>{formatUsdc(receipt.amountAtomicUsdc)}</strong>
                    {receipt.transaction && (
                      <a
                        className="receipt-link"
                        href={arcscanTxUrl(receipt.transaction)}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Arc tx
                      </a>
                    )}
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
                <strong>No payment receipts.</strong>
                <span>No creator payout was routed for this answer.</span>
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}
