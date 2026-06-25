"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { WalletClient } from "viem";
import { formatUsdc, shortHash, shortWallet } from "@/lib/format";
import type {
  CreatorEarnings,
  CreatorSource,
  Ledger,
  LedgerVerification,
  PaymentReceipt,
  SettlementResult,
} from "@/lib/types";

type LedgerResponse = {
  ledger: Ledger;
  creators: CreatorEarnings[];
  verification: LedgerVerification;
};

type Props = {
  sources: CreatorSource[];
  initialLedger: Ledger;
  initialCreators: CreatorEarnings[];
};

type SourcePurchaseResponse = {
  source: CreatorSource;
  settlementMode: string;
  payer?: string;
  transaction?: string | null;
  receipt?: PaymentReceipt;
  ledger?: Ledger;
  error?: string;
};

type SourceRegistryResponse = {
  source?: CreatorSource;
  sources: CreatorSource[];
  error?: string;
};

type SettlementStatusResponse = {
  mode: "verify-only" | "settle-enabled";
  facilitatorConfigured: boolean;
  forumRouterConfigured: boolean;
  paidQueryPriceAtomicUsdc: number;
  tollgateAgentWallet: string;
  readerPaymentTotalAtomicUsdc: number;
  latestReaderPayment: {
    amountAtomicUsdc: number;
    settlementMode: string;
    payTo: string;
    payer?: string;
    transaction?: string;
    paymentResource: string;
    paymentHash: string;
  } | null;
  latestVerifiedReceipt: string | null;
  latestSettledReceipt: string | null;
  latestForumRoutedReceipt: string | null;
  verification: LedgerVerification;
};

type SourceFormState = {
  title: string;
  creator: string;
  handle: string;
  wallet: string;
  url: string;
  summary: string;
  tags: string;
  priceAtomicUsdc: string;
};

const EXAMPLE_QUESTIONS = [
  "How should AI agents pay creators per citation on Arc?",
  "Why do x402 and Gateway make sub-cent source payments possible?",
  "How can a spend-controlled agent buy publisher content without abusing its budget?",
];

const EMPTY_SOURCE_FORM: SourceFormState = {
  title: "",
  creator: "",
  handle: "",
  wallet: "",
  url: "",
  summary: "",
  tags: "",
  priceAtomicUsdc: "1000",
};

function totalPaid(ledger: Ledger): number {
  return ledger.queries.reduce((sum, query) => sum + query.totalAtomicUsdc, 0);
}

function totalReaderPaid(ledger: Ledger): number {
  return ledger.queries.reduce(
    (sum, query) => sum + (query.readerPayment?.amountAtomicUsdc ?? 0),
    0,
  );
}

function latestHash(ledger: Ledger): string {
  return ledger.receipts.at(-1)?.receiptHash ?? `0x${"0".repeat(64)}`;
}

function settlementLabel(mode: string): string {
  if (mode === "forum-routed") return "forum routed";
  if (mode === "x402-settled") return "x402 settled";
  if (mode === "x402-verified") return "x402 verified";
  return "local proof";
}

function shortAddress(address?: string): string {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
}

export function LeptonWebApp({
  sources,
  initialLedger,
  initialCreators,
}: Props) {
  const [question, setQuestion] = useState(EXAMPLE_QUESTIONS[0]);
  const [ledger, setLedger] = useState(initialLedger);
  const [creators, setCreators] = useState(initialCreators);
  const [registrySources, setRegistrySources] = useState(sources);
  const [verification, setVerification] = useState<LedgerVerification | null>(
    null,
  );
  const [settlementStatus, setSettlementStatus] =
    useState<SettlementStatusResponse | null>(null);
  const [activeResult, setActiveResult] = useState<SettlementResult | null>(
    null,
  );
  const [sourceForm, setSourceForm] =
    useState<SourceFormState>(EMPTY_SOURCE_FORM);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [payingSourceId, setPayingSourceId] = useState("");
  const [sourcePaymentStatus, setSourcePaymentStatus] = useState("");
  const [sourceRegistrationStatus, setSourceRegistrationStatus] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegisteringSource, setIsRegisteringSource] = useState(false);

  const stats = useMemo(
    () => ({
      totalPaid: totalPaid(ledger),
      readerPaid: totalReaderPaid(ledger),
      queryCount: ledger.queries.length,
      receiptCount: ledger.receipts.length,
      creatorCount: creators.length,
      sourceCount: registrySources.length,
      latestHash: latestHash(ledger),
    }),
    [creators.length, ledger, registrySources.length],
  );
  const displayedQuery = activeResult?.query ?? ledger.queries[0] ?? null;
  const displayedBudget = displayedQuery?.agentBudget ?? null;
  const displayedDecisions = displayedQuery?.sourceDecisions ?? [];
  const displayedSteps = displayedQuery?.agentSteps ?? [];
  const proofOk = verification?.ok ?? settlementStatus?.verification.ok ?? true;
  const settlementMode = settlementStatus?.mode ?? "verify-only";

  async function refreshLedger() {
    const response = await fetch("/api/ledger", { cache: "no-store" });
    if (!response.ok)
      throw new Error(`ledger fetch failed: ${response.status}`);
    const data = (await response.json()) as LedgerResponse;
    setLedger(data.ledger);
    setCreators(data.creators);
    setVerification(data.verification);
  }

  async function refreshSources() {
    const response = await fetch("/api/sources", { cache: "no-store" });
    if (!response.ok)
      throw new Error(`source registry fetch failed: ${response.status}`);
    const data = (await response.json()) as SourceRegistryResponse;
    setRegistrySources(data.sources);
  }

  async function refreshSettlementStatus() {
    const response = await fetch("/api/settlement/status", {
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(`settlement status failed: ${response.status}`);
    const data = (await response.json()) as SettlementStatusResponse;
    setSettlementStatus(data);
    setVerification(data.verification);
  }

  useEffect(() => {
    refreshLedger().catch((error: unknown) => {
      setStatus(
        error instanceof Error ? error.message : "Ledger refresh failed.",
      );
    });
    refreshSources().catch((error: unknown) => {
      setSourceRegistrationStatus(
        error instanceof Error ? error.message : "Source refresh failed.",
      );
    });
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
      setLedger(result.ledger);
      await refreshLedger();
      await refreshSettlementStatus();
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
      setLedger(result.ledger);
      await refreshLedger();
      await refreshSettlementStatus();
      setStatus("Reader paid, answer settled, and citations receipted.");
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
    setWalletAddress(client.account?.address ?? "");
    return client;
  }

  async function paySource(source: CreatorSource) {
    setPayingSourceId(source.id);
    setSourcePaymentStatus(`Preparing x402 payment for ${source.title}...`);
    try {
      const client = walletClient ?? (await connectWallet());
      const { makePaidFetch } = await import("@/lib/x402-client");
      const paidFetch = makePaidFetch(client);
      const response = await paidFetch(`/api/sources/${source.id}`);
      const body = (await response.json()) as SourcePurchaseResponse;
      if (!response.ok) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      if (body.ledger) setLedger(body.ledger);
      await refreshLedger();
      await refreshSettlementStatus();
      setSourcePaymentStatus(
        `${source.creator} paid via ${settlementLabel(body.settlementMode)}.`,
      );
    } catch (error) {
      setSourcePaymentStatus(
        error instanceof Error ? error.message : "Source payment failed.",
      );
    } finally {
      setPayingSourceId("");
    }
  }

  function updateSourceForm(field: keyof SourceFormState, value: string) {
    setSourceForm((current) => ({ ...current, [field]: value }));
  }

  async function registerSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRegisteringSource(true);
    setSourceRegistrationStatus("Registering priced source...");
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sourceForm),
      });
      const body = (await response.json()) as SourceRegistryResponse;
      if (!response.ok) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setRegistrySources(body.sources);
      setSourceForm(EMPTY_SOURCE_FORM);
      setSourceRegistrationStatus(
        `${body.source?.creator ?? "Creator"} source registered.`,
      );
    } catch (error) {
      setSourceRegistrationStatus(
        error instanceof Error ? error.message : "Source registration failed.",
      );
    } finally {
      setIsRegisteringSource(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar" aria-label="Product header">
        <a className="skip-link" href="#ask">
          Skip to query
        </a>
        <div className="brand">
          <h1>Tollgate</h1>
          <p className="eyebrow">Paid knowledge network · live on Arc</p>
        </div>
        <div className="top-actions">
          <div className="network-pill" aria-label="Settlement mode">
            <span className="live-dot" />
            x402 {settlementMode}
          </div>
          <div className="network-pill" aria-label="Forum routing">
            <span className="live-dot" />
            Forum{" "}
            {settlementStatus?.forumRouterConfigured ? "routing" : "ready"}
          </div>
          <div className="network-pill" aria-label="Ledger verification">
            <span className={proofOk ? "live-dot" : "live-dot alert-dot"} />
            ledger {proofOk ? "verified" : "needs review"}
          </div>
          <Link className="wallet-button" href="/core">
            Core
          </Link>
          <a className="wallet-button" href="/aperture">
            Photos
          </a>
          <Link className="wallet-button" href="/proof">
            Proof
          </Link>
          <Link className="wallet-button" href="/demo">
            Demo
          </Link>
          <button
            className="wallet-button primary"
            type="button"
            onClick={() => {
              connectWallet().catch((error: unknown) => {
                setSourcePaymentStatus(
                  error instanceof Error
                    ? error.message
                    : "Wallet connection failed.",
                );
              });
            }}
          >
            {walletAddress ? shortAddress(walletAddress) : "Connect wallet"}
          </button>
        </div>
      </header>

      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">For writers, publishers &amp; photographers</p>
          <h2 id="hero-title">Get paid when AI uses your work.</h2>
          <p className="hero-text">
            Register a piece of your work once. Whenever Tollgate&apos;s AI
            cites it to answer a question, you&apos;re paid in dollars (USDC) —
            instantly, with a receipt that proves it. No subscriptions, no
            middlemen.
          </p>
        </div>
        <div className="signature-stat" aria-live="polite">
          <span className="stat-label">creator earnings recorded</span>
          <strong>{formatUsdc(stats.totalPaid)}</strong>
          <span className="stat-unit">USDC</span>
        </div>
      </section>

      <section className="ticker" aria-label="Live receipt ticker">
        <div className="ticker-track">
          {[...ledger.receipts.slice(-8), ...ledger.receipts.slice(-8)].map(
            (receipt, index) => (
              <span key={`${receipt.receiptHash}-${index}`}>
                {receipt.creator} +{formatUsdc(receipt.amountAtomicUsdc)} USDC /{" "}
                {shortHash(receipt.receiptHash)}
              </span>
            ),
          )}
          {ledger.receipts.length === 0 && (
            <>
              <span>Awaiting first paid citation receipt</span>
              <span>Registered sources ready for attribution</span>
              <span>Gateway/x402 adapter boundary prepared</span>
            </>
          )}
        </div>
      </section>

      <section className="how-it-works" aria-label="How it works">
        <ol className="step-grid">
          <li className="step-card">
            <span className="step-num">1</span>
            <h3>Register your work</h3>
            <p>
              Add a link to one thing you&apos;ve made — an article, a photo, a
              video. Takes a minute, no account needed.
            </p>
          </li>
          <li className="step-card">
            <span className="step-num">2</span>
            <h3>AI cites it and pays you</h3>
            <p>
              When the answer agent uses your work, it pays you for that
              citation in USDC — automatically, every time.
            </p>
          </li>
          <li className="step-card">
            <span className="step-num">3</span>
            <h3>Withdraw anytime</h3>
            <p>
              Your earnings collect in your wallet. Cash out whenever you like —
              and every payment is on the public record.
            </p>
          </li>
        </ol>
      </section>

      <section className="workbench" id="ask">
        <div className="ask-panel">
          <div className="panel-heading">
            <p className="eyebrow">live demo</p>
            <h3>Try it — ask a question</h3>
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
              `Paid answers cost ${formatUsdc(
                settlementStatus?.paidQueryPriceAtomicUsdc ?? 1000,
              )} USDC and append receipt-linked citations.`}
          </p>
          <p className="status-line source-status" aria-live="polite">
            {sourcePaymentStatus ||
              "Use a priced source row below to sign one x402 source payment."}
          </p>
        </div>

        <div className="answer-panel">
          <div className="panel-heading">
            <p className="eyebrow">latest answer</p>
            <h3>Attribution receipt</h3>
          </div>
          {displayedQuery ? (
            <>
              <p className="answer-text">{displayedQuery.answer}</p>
              <div className="receipt-grid">
                <div>
                  <span>query hash</span>
                  <strong>{shortHash(displayedQuery.queryHash)}</strong>
                  <Link
                    className="receipt-link"
                    href={`/answers/${displayedQuery.id}`}
                  >
                    Open answer
                  </Link>
                </div>
                <div>
                  <span>answer hash</span>
                  <strong>{shortHash(displayedQuery.answerHash)}</strong>
                </div>
                <div>
                  <span>paid citations</span>
                  <strong>{displayedQuery.citations.length}</strong>
                </div>
                <div>
                  <span>total paid</span>
                  <strong>{formatUsdc(displayedQuery.totalAtomicUsdc)}</strong>
                </div>
              </div>
              {displayedQuery.readerPayment && (
                <div className="reader-payment-card">
                  <div>
                    <span>reader payment</span>
                    <strong>
                      {settlementLabel(
                        displayedQuery.readerPayment.settlementMode,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>payer</span>
                    <strong>
                      {displayedQuery.readerPayment.payer
                        ? shortWallet(displayedQuery.readerPayment.payer)
                        : "pending"}
                    </strong>
                  </div>
                  <div>
                    <span>amount</span>
                    <strong>
                      {formatUsdc(
                        displayedQuery.readerPayment.amountAtomicUsdc,
                      )}{" "}
                      USDC
                    </strong>
                  </div>
                  <div>
                    <span>payment hash</span>
                    <strong>
                      {shortHash(displayedQuery.readerPayment.paymentHash)}
                    </strong>
                  </div>
                </div>
              )}
              {displayedSteps.length > 0 && (
                <div className="decision-board">
                  <div className="decision-summary">
                    <div>
                      <span>agent mode</span>
                      <strong>
                        {displayedQuery.agentMode === "llm"
                          ? "reasoning loop"
                          : "deterministic"}
                      </strong>
                    </div>
                    <div>
                      <span>steps</span>
                      <strong>{displayedSteps.length}</strong>
                    </div>
                  </div>
                  <div className="decision-list">
                    {displayedSteps.map((step) => (
                      <article
                        className="decision-row selected"
                        key={step.index}
                      >
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
              {displayedBudget && displayedDecisions.length > 0 && (
                <div className="decision-board">
                  <div className="decision-summary">
                    <div>
                      <span>source budget</span>
                      <strong>
                        {formatUsdc(displayedBudget.sourceBudgetAtomicUsdc)}
                      </strong>
                    </div>
                    <div>
                      <span>agent spent</span>
                      <strong>
                        {formatUsdc(displayedBudget.spentAtomicUsdc)}
                      </strong>
                    </div>
                    <div>
                      <span>remaining</span>
                      <strong>
                        {formatUsdc(displayedBudget.remainingAtomicUsdc)}
                      </strong>
                    </div>
                    <div>
                      <span>market sweep</span>
                      <strong>
                        {displayedBudget.purchasedCount}/
                        {displayedBudget.candidateCount}
                      </strong>
                    </div>
                  </div>
                  <div className="decision-list">
                    {displayedDecisions.slice(0, 6).map((decision) => (
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
              )}
              <div className="citation-list">
                {displayedQuery.citations.map((citation) => (
                  <article className="citation-card" key={citation.sourceId}>
                    <div>
                      <p>{citation.title}</p>
                      <span>
                        {citation.creator} /{" "}
                        {formatUsdc(citation.amountAtomicUsdc)} USDC
                      </span>
                    </div>
                    <small>{citation.reason}</small>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <div className="empty-state">
              <strong>No answer settled yet.</strong>
              <span>
                Run a query to see the paid citations, answer hash, and receipt
                chain.
              </span>
            </div>
          )}
        </div>
      </section>

      <section className="metrics-band" aria-label="Ledger metrics">
        <Metric label="queries" value={stats.queryCount.toString()} />
        <Metric label="receipts" value={stats.receiptCount.toString()} />
        <Metric label="reader paid" value={formatUsdc(stats.readerPaid)} />
        <Metric
          label="earning creators"
          value={stats.creatorCount.toString()}
        />
        <Metric label="priced sources" value={stats.sourceCount.toString()} />
        <Metric
          label="latest receipt"
          value={shortHash(stats.latestHash)}
          wide
        />
      </section>

      <section className="lower-grid">
        <div className="creator-table">
          <div className="panel-heading">
            <p className="eyebrow">creator earnings</p>
            <h3>Who got paid</h3>
          </div>
          {creators.length > 0 ? (
            creators.map((creator) => (
              <div className="creator-row" key={creator.wallet}>
                <div>
                  <strong>{creator.creator}</strong>
                  <span>
                    {creator.handle} / {shortWallet(creator.wallet)}
                  </span>
                </div>
                <div className="numeric-cell">
                  <strong>{formatUsdc(creator.earnedAtomicUsdc)}</strong>
                  <Link
                    className="receipt-link"
                    href={`/creators/${creator.wallet}`}
                  >
                    {creator.citationCount} citations
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state compact">
              <strong>No creators paid yet.</strong>
              <span>Run the first query to populate the earnings board.</span>
            </div>
          )}
        </div>

        <div className="source-registry">
          <div className="panel-heading">
            <p className="eyebrow">priced source registry</p>
            <h3>Creator inventory</h3>
          </div>
          <form className="register-source-form" onSubmit={registerSource}>
            <div className="form-grid">
              <div>
                <label htmlFor="source-title">Title</label>
                <input
                  id="source-title"
                  value={sourceForm.title}
                  onChange={(event) =>
                    updateSourceForm("title", event.target.value)
                  }
                />
              </div>
              <div>
                <label htmlFor="source-creator">Creator</label>
                <input
                  id="source-creator"
                  value={sourceForm.creator}
                  onChange={(event) =>
                    updateSourceForm("creator", event.target.value)
                  }
                />
              </div>
              <div>
                <label htmlFor="source-handle">Handle</label>
                <input
                  id="source-handle"
                  value={sourceForm.handle}
                  onChange={(event) =>
                    updateSourceForm("handle", event.target.value)
                  }
                />
              </div>
              <div>
                <label htmlFor="source-price">Atomic USDC</label>
                <input
                  id="source-price"
                  inputMode="numeric"
                  value={sourceForm.priceAtomicUsdc}
                  onChange={(event) =>
                    updateSourceForm("priceAtomicUsdc", event.target.value)
                  }
                />
              </div>
            </div>
            <label htmlFor="source-wallet">Wallet</label>
            <input
              id="source-wallet"
              value={sourceForm.wallet}
              onChange={(event) =>
                updateSourceForm("wallet", event.target.value)
              }
            />
            <label htmlFor="source-url">URL</label>
            <input
              id="source-url"
              value={sourceForm.url}
              onChange={(event) => updateSourceForm("url", event.target.value)}
            />
            <label htmlFor="source-summary">Summary</label>
            <textarea
              id="source-summary"
              value={sourceForm.summary}
              rows={3}
              onChange={(event) =>
                updateSourceForm("summary", event.target.value)
              }
            />
            <label htmlFor="source-tags">Tags</label>
            <input
              id="source-tags"
              value={sourceForm.tags}
              onChange={(event) => updateSourceForm("tags", event.target.value)}
            />
            <button
              type="submit"
              className="source-register-button"
              disabled={isRegisteringSource}
            >
              {isRegisteringSource ? "registering..." : "Register source"}
            </button>
            <p className="status-line source-status" aria-live="polite">
              {sourceRegistrationStatus ||
                "New creator sources join the same paid citation rail."}
            </p>
          </form>
          <div className="source-list">
            {registrySources.map((source) => (
              <article key={source.id} className="source-card">
                <div>
                  <p>{source.title}</p>
                  <span>
                    {source.creator} / {`/api/sources/${source.id}`}
                  </span>
                </div>
                <div className="source-action">
                  <strong>{formatUsdc(source.priceAtomicUsdc)} USDC</strong>
                  <Link className="receipt-link" href={`/sources/${source.id}`}>
                    Evidence page
                  </Link>
                  <button
                    type="button"
                    className="source-pay-button"
                    onClick={() => {
                      paySource(source);
                    }}
                    disabled={payingSourceId === source.id}
                  >
                    {payingSourceId === source.id ? "paying..." : "Pay source"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="receipt-ledger">
        <div className="panel-heading">
          <p className="eyebrow">receipt chain</p>
          <h3>Settlement evidence</h3>
        </div>
        {ledger.receipts
          .slice()
          .reverse()
          .slice(0, 8)
          .map((receipt) => (
            <article className="receipt-row" key={receipt.receiptHash}>
              <div>
                <strong>{receipt.creator}</strong>
                <span>
                  {settlementLabel(receipt.settlementMode)} /{" "}
                  {receipt.paymentResource ??
                    `/api/sources/${receipt.sourceId}`}
                </span>
              </div>
              <div className="numeric-cell">
                <strong>{formatUsdc(receipt.amountAtomicUsdc)}</strong>
                <a
                  className="receipt-link"
                  href={`/receipts/${receipt.receiptHash}`}
                >
                  {shortHash(receipt.receiptHash)}
                </a>
              </div>
            </article>
          ))}
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "metric wide" : "metric"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
