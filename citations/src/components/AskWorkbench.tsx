"use client";

import { useEffect, useState } from "react";
import type { WalletClient } from "viem";
import { formatDollars } from "@/lib/format";
import type {
  CreatorEarnings,
  Ledger,
  LedgerVerification,
  SettlementResult,
  SettlementStatus,
} from "@/lib/types";
import { LatestAnswer } from "./LatestAnswer";

type LedgerResponse = {
  ledger: Ledger;
  creators: CreatorEarnings[];
  verification: LedgerVerification;
};

type Props = {
  initialLedger: Ledger;
};

export const EXAMPLE_QUESTIONS = [
  "How should AI agents pay creators per citation on Arc?",
  "Why do x402 and Gateway make sub-cent source payments possible?",
  "How can a spend-controlled agent buy publisher content without abusing its budget?",
];

export function AskWorkbench({ initialLedger }: Props) {
  const [question, setQuestion] = useState(EXAMPLE_QUESTIONS[0]);
  const [ledger, setLedger] = useState(initialLedger);
  const [verification, setVerification] = useState<LedgerVerification | null>(
    null,
  );
  const [settlementStatus, setSettlementStatus] =
    useState<SettlementStatus | null>(null);
  const [activeResult, setActiveResult] = useState<SettlementResult | null>(
    null,
  );
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const displayedQuery = activeResult?.query ?? ledger.queries[0] ?? null;
  const displayedBudget = displayedQuery?.agentBudget ?? null;
  const displayedDecisions = displayedQuery?.sourceDecisions ?? [];
  const displayedSteps = displayedQuery?.agentSteps ?? [];

  function updateLedger(nextLedger: Ledger) {
    setLedger(nextLedger);
  }

  async function refreshLedger() {
    const response = await fetch("/api/ledger", { cache: "no-store" });
    if (!response.ok)
      throw new Error(`ledger fetch failed: ${response.status}`);
    const data = (await response.json()) as LedgerResponse;
    updateLedger(data.ledger);
    setVerification(data.verification);
  }

  async function refreshSettlementStatus() {
    const response = await fetch("/api/settlement/status", {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`settlement status failed: ${response.status}`);
    const data = (await response.json()) as SettlementStatus;
    setSettlementStatus(data);
    setVerification(data.verification);
  }

  useEffect(() => {
    refreshSettlementStatus().catch((error: unknown) => {
      setStatus(
        error instanceof Error
          ? error.message
          : "Settlement status refresh failed.",
      );
    });
  }, []);

  async function runQuery() {
    setIsSubmitting(true);
    setStatus("Pricing sources and writing attribution receipts...");
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = (await response.json()) as
        | SettlementResult
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body ? body.error : `HTTP ${response.status}`,
        );
      }
      const result = body as SettlementResult;
      setActiveResult(result);
      updateLedger(result.ledger);
      await Promise.all([refreshLedger(), refreshSettlementStatus()]);
      setStatus("Answer paid, attributed, and receipt-linked.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Query failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function runPaidQuery() {
    setIsSubmitting(true);
    setStatus("Requesting x402 reader payment for the answer...");
    try {
      const client = walletClient ?? (await connectWallet());
      const { makePaidFetch } = await import("@/lib/x402-client");
      const paidFetch = makePaidFetch(client);
      const response = await paidFetch("/api/paid-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = (await response.json()) as
        | SettlementResult
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body ? body.error : `HTTP ${response.status}`,
        );
      }
      const result = body as SettlementResult;
      setActiveResult(result);
      updateLedger(result.ledger);
      await Promise.all([refreshLedger(), refreshSettlementStatus()]);
      setStatus("Reader paid, answer recorded, and citations receipted.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Paid query failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function connectWallet() {
    const { connectArcWallet } = await import("@/lib/x402-client");
    const client = await connectArcWallet();
    setWalletClient(client);
    return client;
  }

  return (
    <section className="workbench" id="ask">
      <div className="ask-panel">
        <div className="panel-heading">
          <p className="eyebrow">live demo</p>
          <h3>Ask a paid question</h3>
        </div>
        <div className="mode-badge-row">
          <span className="mode-badge">
            {(verification?.ok ?? settlementStatus?.verification.ok ?? true)
              ? "verified ledger"
              : "ledger review"}
          </span>
          <span className="mode-badge">
            {formatDollars(
              settlementStatus?.paidQueryPriceAtomicUsdc ?? 10_000,
            )}{" "}
            reader price
          </span>
        </div>
        <label htmlFor="question">Question</label>
        <textarea
          id="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={4}
        />
        <div className="example-row">
          {EXAMPLE_QUESTIONS.map((example) => (
            <button
              type="button"
              className="ghost-button"
              key={example}
              onClick={() => setQuestion(example)}
            >
              {example}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={runPaidQuery}
          disabled={isSubmitting}
        >
          {isSubmitting ? "settling..." : "Run paid answer"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={runQuery}
          disabled={isSubmitting}
        >
          Run local proof
        </button>
        <p className="status-line" aria-live="polite">
          {status ||
            `A paid answer costs ${formatDollars(
              settlementStatus?.paidQueryPriceAtomicUsdc ?? 10_000,
            )} and pays every creator it cites.`}
        </p>
      </div>
      <LatestAnswer
        query={displayedQuery}
        budget={displayedBudget}
        decisions={displayedDecisions}
        steps={displayedSteps}
      />
    </section>
  );
}
