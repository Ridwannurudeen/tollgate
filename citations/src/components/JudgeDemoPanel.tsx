"use client";

import { useState } from "react";
import {
  arcscanTxUrl,
  formatDollars,
  settlementLabel,
  shortHash,
  shortWallet,
} from "@/lib/format";
import type {
  Ledger,
  PaymentReceipt,
  QueryPaymentEvidence,
  QueryRecord,
} from "@/lib/types";

type JudgeDemoPayload = {
  judgeDemo?: boolean;
  stage?: string | null;
  question?: string;
  error?: string;
  check?: string;
  priorFailure?: { stage: string; message: string };
  query?: Partial<QueryRecord>;
  receipts?: PaymentReceipt[];
  ledger?: Ledger;
  readerPayment?: QueryPaymentEvidence;
  creatorBalances?: CreatorBalanceChange[];
  creatorBalancesBefore?: CreatorBalanceBefore[];
};

type CreatorBalanceBefore = {
  sourceId: string;
  creator: string;
  wallet: string;
  beforeAtomicUsdc: string;
};

type CreatorBalanceChange = CreatorBalanceBefore & {
  afterAtomicUsdc: string;
  deltaAtomicUsdc: string;
};

type DemoState = "idle" | "running" | "success" | "failure";

type ArcTransaction = {
  label: string;
  transaction: string;
};

const ARC_TRANSACTION_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function objectPayload(value: unknown): JudgeDemoPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JudgeDemoPayload)
    : {};
}

function optionalDollars(value: number | undefined): string {
  return value === undefined ? "not returned" : formatDollars(value);
}

function atomicUsdcText(value: string): string {
  if (!/^-?\d+$/.test(value)) return value;
  const atomic = BigInt(value);
  const sign = atomic < 0n ? "-" : "";
  const absolute = atomic < 0n ? -atomic : atomic;
  const whole = absolute / 1_000_000n;
  const fraction = (absolute % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${sign}$${whole}${fraction ? `.${fraction}` : ""}`;
}

function positiveAtomic(value: string): boolean {
  return /^\d+$/.test(value) && BigInt(value) > 0n;
}

function transactionEvidence(
  payload: JudgeDemoPayload | null,
  readerPayment: QueryPaymentEvidence | undefined,
): ArcTransaction[] {
  const rows: ArcTransaction[] = [];
  const seen = new Set<string>();
  const add = (label: string, transaction: string | undefined) => {
    if (!transaction || seen.has(transaction)) return;
    seen.add(transaction);
    rows.push({ label, transaction });
  };

  add("reader payment", readerPayment?.transaction);
  add("reader refund", readerPayment?.refund?.transaction);
  for (const receipt of payload?.receipts ?? []) {
    add(`FeeRouter split / ${receipt.creator}`, receipt.feeRouterCreateSplitTx);
    add(`FeeRouter payout / ${receipt.creator}`, receipt.feeRouterPayTx);
    add(`citation settlement / ${receipt.creator}`, receipt.transaction);
  }
  add("use-intent anchor", payload?.query?.useIntent?.anchorTx);
  return rows;
}

function ArcTransactionLink({ transaction }: { transaction: string }) {
  if (!ARC_TRANSACTION_PATTERN.test(transaction)) {
    return <>{shortHash(transaction)}</>;
  }
  return (
    <a
      className="receipt-link inline-link"
      href={arcscanTxUrl(transaction)}
      rel="noreferrer"
      target="_blank"
    >
      {shortHash(transaction)}
    </a>
  );
}

export function JudgeDemoPanel() {
  const [demoState, setDemoState] = useState<DemoState>("idle");
  const [payload, setPayload] = useState<JudgeDemoPayload | null>(null);

  const query = payload?.query;
  const readerPayment = payload?.readerPayment ?? query?.readerPayment;
  const decisions = query?.sourceDecisions ?? [];
  const claimSupport = query?.claimSupport ?? [];
  const refundSummary = query?.refundSummary;
  const useIntent = query?.useIntent;
  const creatorBalances = payload?.creatorBalances ?? [];
  const creatorBalancesBefore = payload?.creatorBalancesBefore ?? [];
  const arcTransactions = transactionEvidence(payload, readerPayment);
  const boughtCount = decisions.filter((decision) => decision.selected).length;
  const skippedCount = decisions.length - boughtCount;
  const supportedClaims = claimSupport.filter(
    (support) => support.status === "supported",
  ).length;
  const stage = payload?.stage?.trim() || "not returned by API";

  async function runJudgeDemo() {
    setDemoState("running");
    setPayload(null);
    try {
      const response = await fetch("/api/judge-demo", { method: "POST" });
      const body = objectPayload(await response.json().catch(() => null));
      setPayload(body);
      setDemoState(response.ok ? "success" : "failure");
    } catch (error) {
      setPayload({
        stage: "client-transport",
        error:
          error instanceof Error
            ? error.message
            : "The browser could not reach the judge demonstration route.",
      });
      setDemoState("failure");
    }
  }

  return (
    <section
      className="receipt-context profile-section"
      aria-labelledby="judge-demo-title"
    >
      <div className="panel-heading">
        <p className="eyebrow">90-second proof path</p>
        <h3 id="judge-demo-title">Verified judge demonstration</h3>
      </div>
      <p className="answer-text">
        One sponsored request runs the fixed question through strict model
        planning, source selection, claim verification, settlement, refunds, and
        signed use-intent anchoring. Failed stages remain failed and keep any
        evidence already returned.
      </p>
      <button
        type="button"
        className="primary-button"
        onClick={runJudgeDemo}
        disabled={demoState === "running"}
      >
        {demoState === "running"
          ? "Running the verified judge demonstration..."
          : "Run the verified judge demonstration"}
      </button>
      <p className="status-line">
        sponsor-funded judge activity — excluded from traction
      </p>
      <p className="status-line" aria-live="polite">
        {demoState === "idle" &&
          "No wallet or login is required. The API will expose the exact stage reached."}
        {demoState === "running" &&
          "Starting the sponsored payment and judge-strict agent run..."}
        {demoState === "success" &&
          `Completed at stage ${stage}. The returned evidence is shown below.`}
        {demoState === "failure" &&
          `Failed at stage ${stage}: ${payload?.error ?? "No error message was returned."}`}
      </p>

      {demoState === "failure" && payload && (
        <div className="decision-board" role="alert">
          <div className="decision-summary">
            <div>
              <span>result</span>
              <strong>failed</strong>
            </div>
            <div>
              <span>exact stage</span>
              <strong>{stage}</strong>
            </div>
            <div>
              <span>failed check</span>
              <strong>{payload.check ?? "not returned"}</strong>
            </div>
            <div>
              <span>reader payment evidence</span>
              <strong>{readerPayment ? "returned" : "not returned"}</strong>
            </div>
            <div>
              <span>query evidence</span>
              <strong>{query ? "returned" : "not returned"}</strong>
            </div>
          </div>
          <p className="status-line">
            {payload.error ?? "No structured error message was returned."}
          </p>
        </div>
      )}

      {payload?.priorFailure && (
        <section className="decision-board" aria-label="Prior failure">
          <div className="panel-heading">
            <p className="eyebrow">prior failure</p>
            <h3>{payload.priorFailure.stage}</h3>
          </div>
          <p className="status-line">{payload.priorFailure.message}</p>
        </section>
      )}

      {readerPayment && (
        <section aria-label="Reader payment evidence">
          <div className="panel-heading">
            <p className="eyebrow">reader payment evidence</p>
            <h3>
              {readerPayment.refund ? "Payment refunded" : "Payment recorded"}
            </h3>
          </div>
          <div className="reader-payment-card receipt-payment-card">
            <div>
              <span>settlement</span>
              <strong>{settlementLabel(readerPayment.settlementMode)}</strong>
            </div>
            <div>
              <span>payer</span>
              <strong>
                {readerPayment.payer
                  ? shortWallet(readerPayment.payer)
                  : "not returned"}
              </strong>
            </div>
            <div>
              <span>amount</span>
              <strong>{formatDollars(readerPayment.amountAtomicUsdc)}</strong>
            </div>
            <div>
              <span>actor class</span>
              <strong>{readerPayment.actorClass ?? "not returned"}</strong>
            </div>
            <div>
              <span>payment hash</span>
              <strong>{shortHash(readerPayment.paymentHash)}</strong>
            </div>
          </div>
          {readerPayment.refund && (
            <div className="decision-board">
              <div className="decision-summary">
                <div>
                  <span>reader refund</span>
                  <strong>
                    {formatDollars(readerPayment.refund.amountAtomicUsdc)}
                  </strong>
                </div>
                <div>
                  <span>reason</span>
                  <strong>{readerPayment.refund.reason}</strong>
                </div>
                <div>
                  <span>refund tx</span>
                  <strong>
                    <ArcTransactionLink
                      transaction={readerPayment.refund.transaction}
                    />
                  </strong>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {query && (
        <section aria-label="Returned query evidence">
          <div className="panel-heading">
            <p className="eyebrow">returned query evidence</p>
            <h3>
              {query.question ?? payload?.question ?? "Question not returned"}
            </h3>
          </div>
          <div className="receipt-grid">
            <div>
              <span>model</span>
              <strong>{query.agentModel ?? "not returned"}</strong>
            </div>
            <div>
              <span>agent mode</span>
              <strong>{query.agentMode ?? "not returned"}</strong>
            </div>
            <div>
              <span>buy / skip</span>
              <strong>
                {boughtCount} / {skippedCount}
              </strong>
            </div>
            <div>
              <span>supported claims</span>
              <strong>
                {supportedClaims} / {claimSupport.length}
              </strong>
            </div>
          </div>
          <div className="evidence-grid">
            <div className="evidence-row">
              <span>query id</span>
              <strong>{query.id ?? "not returned"}</strong>
            </div>
            <div className="evidence-row">
              <span>query hash</span>
              <strong>{query.queryHash ?? "not returned"}</strong>
            </div>
            <div className="evidence-row">
              <span>claim support root</span>
              <strong>{query.claimSupportRoot ?? "not returned"}</strong>
            </div>
          </div>
        </section>
      )}

      {(decisions.length > 0 || demoState === "success") && (
        <section className="decision-board" aria-label="Source decisions">
          <div className="panel-heading">
            <p className="eyebrow">source market</p>
            <h3>Buy and skip decisions</h3>
          </div>
          {decisions.length > 0 ? (
            <div className="decision-list">
              {decisions.map((decision) => (
                <article
                  className={
                    decision.selected ? "decision-row selected" : "decision-row"
                  }
                  key={decision.sourceId}
                >
                  <div>
                    <strong>
                      {decision.selected ? "buy" : "skip"} / {decision.title}
                    </strong>
                    <span>
                      {decision.creator} /{" "}
                      {formatDollars(decision.priceAtomicUsdc)}
                    </span>
                  </div>
                  <small>{decision.reason}</small>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No source decision trace returned.</strong>
              <span>The panel will not infer decisions from citations.</span>
            </div>
          )}
        </section>
      )}

      {(claimSupport.length > 0 || demoState === "success") && (
        <section className="decision-board" aria-label="Claim support">
          <div className="panel-heading">
            <p className="eyebrow">proof of useful citation</p>
            <h3>Claim support</h3>
          </div>
          {claimSupport.length > 0 ? (
            <div className="decision-list">
              {claimSupport.map((support, index) => (
                <article
                  className={
                    support.status === "supported"
                      ? "decision-row selected"
                      : "decision-row"
                  }
                  key={`${support.sourceId ?? "none"}-${index}`}
                >
                  <div>
                    <strong>{support.status}</strong>
                    <span>{support.sourceId ?? "no source"}</span>
                  </div>
                  <small>
                    {support.claim}
                    {support.span ? ` / span: ${support.span}` : " / no span"}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No claim-support table returned.</strong>
              <span>
                That absence is shown instead of implying verification.
              </span>
            </div>
          )}
        </section>
      )}

      {(refundSummary || demoState === "success") && (
        <section className="decision-board" aria-label="Source refunds">
          <div className="panel-heading">
            <p className="eyebrow">unused purchases</p>
            <h3>Refunds</h3>
          </div>
          <div className="decision-summary">
            <div>
              <span>bought</span>
              <strong>{refundSummary?.boughtCount ?? "not returned"}</strong>
            </div>
            <div>
              <span>cited</span>
              <strong>{refundSummary?.citedCount ?? "not returned"}</strong>
            </div>
            <div>
              <span>refunded</span>
              <strong>{refundSummary?.refundedCount ?? "not returned"}</strong>
            </div>
            <div>
              <span>refund amount</span>
              <strong>
                {optionalDollars(refundSummary?.refundedAtomicUsdc)}
              </strong>
            </div>
          </div>
        </section>
      )}

      {(useIntent || demoState === "success") && (
        <section aria-label="Signed use intent">
          <div className="panel-heading">
            <p className="eyebrow">EIP-712 TollgateUseIntent</p>
            <h3>Signed decision-to-spend anchor</h3>
          </div>
          {useIntent ? (
            <div className="evidence-grid">
              <div className="evidence-row">
                <span>intent digest</span>
                <strong>{useIntent.digest}</strong>
              </div>
              <div className="evidence-row">
                <span>claim support root</span>
                <strong>{useIntent.claimSupportRoot}</strong>
              </div>
              <div className="evidence-row">
                <span>Arc anchor tx</span>
                <strong>
                  <ArcTransactionLink transaction={useIntent.anchorTx} />
                </strong>
              </div>
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No use-intent anchor returned.</strong>
              <span>The response is not presented as anchored.</span>
            </div>
          )}
        </section>
      )}

      {(creatorBalances.length > 0 ||
        creatorBalancesBefore.length > 0 ||
        demoState === "success") && (
        <section
          className="decision-board"
          aria-label="Creator FeeRouter balance changes"
        >
          <div className="panel-heading">
            <p className="eyebrow">creator payout effect</p>
            <h3>FeeRouter claimable balance change</h3>
          </div>
          {creatorBalances.length > 0 ? (
            <div className="decision-list">
              {creatorBalances.map((balance) => (
                <article
                  className={
                    positiveAtomic(balance.deltaAtomicUsdc)
                      ? "decision-row selected"
                      : "decision-row"
                  }
                  key={balance.sourceId}
                >
                  <div>
                    <strong>{balance.creator}</strong>
                    <span>
                      {atomicUsdcText(balance.beforeAtomicUsdc)} →{" "}
                      {atomicUsdcText(balance.afterAtomicUsdc)}
                    </span>
                  </div>
                  <small>
                    {balance.sourceId} / delta{" "}
                    {atomicUsdcText(balance.deltaAtomicUsdc)} /{" "}
                    {shortWallet(balance.wallet)}
                  </small>
                </article>
              ))}
            </div>
          ) : creatorBalancesBefore.length > 0 ? (
            <div className="decision-list">
              {creatorBalancesBefore.map((balance) => (
                <article className="decision-row" key={balance.sourceId}>
                  <div>
                    <strong>{balance.creator}</strong>
                    <span>
                      before {atomicUsdcText(balance.beforeAtomicUsdc)}
                    </span>
                  </div>
                  <small>Updated balance was not returned.</small>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No creator balance delta returned.</strong>
              <span>The response is not presented as a payout change.</span>
            </div>
          )}
        </section>
      )}

      {(arcTransactions.length > 0 || demoState === "success") && (
        <section aria-label="Arc transactions">
          <div className="panel-heading">
            <p className="eyebrow">Arc testnet</p>
            <h3>Transaction links</h3>
          </div>
          {arcTransactions.length > 0 ? (
            <div className="evidence-grid">
              {arcTransactions.map((row) => (
                <div className="evidence-row" key={row.transaction}>
                  <span>{row.label}</span>
                  <strong>
                    <ArcTransactionLink transaction={row.transaction} />
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state compact">
              <strong>No Arc transaction hashes returned.</strong>
              <span>No explorer link is fabricated.</span>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
