"use client";

import { useEffect, useState } from "react";
import type { WalletClient } from "viem";
import { formatDollars } from "@/lib/format";
import { latestShowcaseQuery } from "@/lib/query-display";
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

const CIRCLE_FAUCET_URL = "https://faucet.circle.com";

function errorValue(error: unknown, key: string): unknown {
  if (!error || typeof error !== "object" || !(key in error)) return undefined;
  return (error as Record<string, unknown>)[key];
}

function paidQueryErrorText(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.name, error.message);
  }
  for (const key of ["code", "shortMessage", "details"]) {
    const value = errorValue(error, key);
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
    }
  }
  const cause = errorValue(error, "cause");
  if (cause instanceof Error) {
    parts.push(cause.name, cause.message);
  }
  return parts.join(" ").toLowerCase();
}

export function paidQueryErrorMessage(
  error: unknown,
  priceText: string,
): string {
  const errorText = paidQueryErrorText(error);
  if (errorText.includes("no injected wallet found")) {
    return "No wallet detected. Install MetaMask (or any Arc-compatible wallet) and try again.";
  }
  if (
    errorText.includes("4001") ||
    errorText.includes("user rejected") ||
    errorText.includes("rejected the request") ||
    errorText.includes("denied") ||
    errorText.includes("cancelled") ||
    errorText.includes("canceled")
  ) {
    return `Payment cancelled - approve the wallet prompt to pay ${priceText} and get your answer.`;
  }
  if (
    errorText.includes("invalid_exact_evm_insufficient_balance") ||
    errorText.includes("invalid_batch_settlement_evm_insufficient_balance") ||
    errorText.includes("permit2_insufficient_balance") ||
    errorText.includes("erc20insufficientbalance") ||
    errorText.includes("transfer exceeds balance") ||
    errorText.includes("transfer failed") ||
    errorText.includes("insufficient balance") ||
    errorText.includes("insufficient funds") ||
    errorText.includes("insufficient usdc")
  ) {
    return "Your wallet needs a little Arc-testnet USDC. Get it free at faucet.circle.com, then retry.";
  }
  return error instanceof Error ? error.message : "Paid query failed.";
}

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

  const displayedQuery =
    activeResult?.query ?? latestShowcaseQuery(ledger.queries);
  const displayedBudget = displayedQuery?.agentBudget ?? null;
  const displayedDecisions = displayedQuery?.sourceDecisions ?? [];
  const displayedSteps = displayedQuery?.agentSteps ?? [];
  const paidQueryPrice = settlementStatus?.paidQueryPriceAtomicUsdc ?? 10_000;
  const paidQueryPriceText = formatDollars(paidQueryPrice);

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
      setStatus(paidQueryErrorMessage(error, paidQueryPriceText));
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
          <span className="mode-badge">{paidQueryPriceText} reader price</span>
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
          onClick={runQuery}
          disabled={isSubmitting}
        >
          {isSubmitting
            ? "running..."
            : "Run the agent free - no wallet needed"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={runPaidQuery}
          disabled={isSubmitting}
        >
          Pay {paidQueryPriceText} via x402 (MetaMask + Arc)
        </button>
        <p className="status-line" aria-live="polite">
          {status ||
            `Run a local proof free, or pay ${paidQueryPriceText} via x402 to exercise the protocol path.`}
        </p>
        <p className="field-hint">
          Pay from any Arc-testnet wallet - connect MetaMask when prompted. Need
          test USDC?{" "}
          <a
            className="inline-link"
            href={CIRCLE_FAUCET_URL}
            target="_blank"
            rel="noopener"
          >
            Get it free at faucet.circle.com
          </a>
          .
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
