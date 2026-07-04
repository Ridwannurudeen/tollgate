"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { WalletClient } from "viem";
import {
  formatDollars,
  settlementLabel,
  shortHash,
  shortWallet,
} from "@/lib/format";
import {
  recentReceiptTickerReceipts,
  verifiedExternalCreatorSources,
} from "@/lib/first-load";
import type {
  CreatorEarnings,
  CreatorSource,
  Ledger,
  LedgerVerification,
  SettlementResult,
  SettlementStatus,
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

type SourceRegistryResponse = {
  source?: CreatorSource;
  sources: CreatorSource[];
  error?: string;
};

type SourceFormState = {
  title: string;
  creator: string;
  handle: string;
  wallet: string;
  url: string;
  summary: string;
  tags: string;
  notifyEmail: string;
  contributors: string;
  priceAtomicUsdc: string;
};

type RssImportPost = {
  title: string;
  url: string;
  summary: string;
  tags: string[];
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
  notifyEmail: "",
  contributors: "",
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
    useState<SettlementStatus | null>(null);
  const [activeResult, setActiveResult] = useState<SettlementResult | null>(
    null,
  );
  const [sourceForm, setSourceForm] =
    useState<SourceFormState>(EMPTY_SOURCE_FORM);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [sourceRegistrationStatus, setSourceRegistrationStatus] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [rssPosts, setRssPosts] = useState<RssImportPost[]>([]);
  const [selectedRssUrls, setSelectedRssUrls] = useState<Set<string>>(
    new Set(),
  );
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRegisteringSource, setIsRegisteringSource] = useState(false);
  const [tickerPaused, setTickerPaused] = useState(false);

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
  const tickerReceipts = useMemo(
    () => recentReceiptTickerReceipts(ledger.receipts),
    [ledger.receipts],
  );
  const externalCreators = useMemo(
    () => verifiedExternalCreatorSources(registrySources),
    [registrySources],
  );

  async function refreshLedger() {
    const response = await fetch("/api/ledger", { cache: "no-store" });
    if (!response.ok)
      throw new Error(`ledger fetch failed: ${response.status}`);
    const data = (await response.json()) as LedgerResponse;
    setLedger(data.ledger);
    setCreators(data.creators);
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
      setLedger(result.ledger);
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
      setLedger(result.ledger);
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

  function updateSourceForm(field: keyof SourceFormState, value: string) {
    setSourceForm((current) => ({ ...current, [field]: value }));
  }

  function sourceRegistrationPayload(overrides: Record<string, unknown> = {}) {
    const baseForm = {
      title: sourceForm.title,
      creator: sourceForm.creator,
      handle: sourceForm.handle,
      wallet: sourceForm.wallet,
      url: sourceForm.url,
      summary: sourceForm.summary,
      tags: sourceForm.tags,
      notifyEmail: sourceForm.notifyEmail,
      priceAtomicUsdc: sourceForm.priceAtomicUsdc,
    };
    const contributors = sourceForm.contributors
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [wallet, share] = entry.split(":").map((part) => part.trim());
        return { wallet, shareBps: Number(share) };
      });
    return {
      ...baseForm,
      ...overrides,
      ...(sourceForm.notifyEmail
        ? { notifyEmail: sourceForm.notifyEmail }
        : {}),
      ...(contributors.length > 0 ? { contributors } : {}),
    };
  }

  async function registerSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRegisteringSource(true);
    setSourceRegistrationStatus("Registering priced source...");
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sourceRegistrationPayload()),
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

  async function discoverFeed() {
    setSourceRegistrationStatus("Looking for feed posts...");
    try {
      const response = await fetch("/api/import/rss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: feedUrl }),
      });
      const body = (await response.json()) as {
        posts?: RssImportPost[];
        error?: string;
      };
      if (!response.ok || !body.posts) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const posts = body.posts.slice(0, 20);
      setRssPosts(posts);
      setSelectedRssUrls(new Set(posts.map((post) => post.url)));
      setSourceRegistrationStatus(`Found ${posts.length} feed post(s).`);
    } catch (error) {
      setSourceRegistrationStatus(
        error instanceof Error ? error.message : "Feed discovery failed.",
      );
    }
  }

  async function registerSelectedFeedPosts() {
    const selected = rssPosts.filter((post) => selectedRssUrls.has(post.url));
    setIsRegisteringSource(true);
    setSourceRegistrationStatus("Registering selected feed posts...");
    let registeredCount = 0;
    let firstError: string | null = null;
    try {
      // Sequential on purpose: each success is preserved, and a failure
      // (duplicate, daily cap) is reported honestly as a partial result.
      for (const post of selected) {
        const response = await fetch("/api/sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            sourceRegistrationPayload({
              title: post.title,
              url: post.url,
              summary: post.summary,
              tags: [...post.tags, sourceForm.tags].join(","),
              origin: "rss-import",
            }),
          ),
        });
        const body = (await response.json()) as SourceRegistryResponse;
        if (!response.ok) {
          firstError = body.error ?? `HTTP ${response.status}`;
          break;
        }
        registeredCount += 1;
        if (body.sources) setRegistrySources(body.sources);
      }
      setSourceRegistrationStatus(
        firstError
          ? `Registered ${registeredCount} of ${selected.length} feed post(s), then stopped: ${firstError}`
          : `Registered ${registeredCount} feed post(s).`,
      );
    } catch (error) {
      setSourceRegistrationStatus(
        registeredCount > 0
          ? `Registered ${registeredCount} of ${selected.length} feed post(s), then failed: ${
              error instanceof Error ? error.message : "Feed import failed."
            }`
          : error instanceof Error
            ? error.message
            : "Feed import failed.",
      );
    } finally {
      setIsRegisteringSource(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar" aria-label="Product header">
        <a className="skip-link" href="#register">
          Skip to register
        </a>
        <div className="brand">
          <h1>Tollgate</h1>
          <p className="eyebrow">Get paid when AI uses your work</p>
        </div>
        <nav className="top-actions" aria-label="Primary">
          <span
            className="network-pill"
            aria-label={
              proofOk ? "Payments live and verified" : "Payments need review"
            }
          >
            <span className={proofOk ? "live-dot" : "live-dot alert-dot"} />
            {proofOk ? "Live" : "Review"}
          </span>
          <a className="wallet-button" href="#how">
            How it works
          </a>
          <Link className="wallet-button" href="/proof">
            Proof
          </Link>
          <a className="wallet-button primary" href="#register">
            Register your work
          </a>
        </nav>
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
          <div className="hero-cta">
            <a className="cta-primary" href="#register">
              Register your work
            </a>
            <a className="cta-secondary" href="#how">
              See how it works
            </a>
          </div>
        </div>
        <div className="signature-stat" aria-live="polite">
          <span className="stat-label">citation payments made</span>
          <strong>{stats.receiptCount}</strong>
          <div className="receipt-lines">
            <span className="receipt-line">
              creators paid <strong>{stats.creatorCount}</strong>
            </span>
            <span className="receipt-line">
              settled in USDC <strong>{formatDollars(stats.totalPaid)}</strong>
            </span>
            <span className="receipt-line">
              proof{" "}
              <strong>
                <Link className="stat-link" href="/proof">
                  verifiable on-chain →
                </Link>
              </strong>
            </span>
          </div>
          <span className="stamp" aria-hidden="true">
            paid · on-chain
          </span>
        </div>
      </section>

      <section className="ticker" aria-label="Live receipt ticker">
        <div className="ticker-viewport">
          <div className={`ticker-track${tickerPaused ? " is-paused" : ""}`}>
            {[...tickerReceipts, ...tickerReceipts].map((receipt, index) => (
              <span key={`${receipt.receiptHash}-${index}`}>
                {receipt.creator} +{formatDollars(receipt.amountAtomicUsdc)}
              </span>
            ))}
            {ledger.receipts.length === 0 && (
              <>
                <span>Awaiting the first paid citation</span>
                <span>Registered works are ready to earn</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          className="ticker-pause"
          aria-pressed={tickerPaused}
          aria-label={
            tickerPaused
              ? "Resume live receipt ticker"
              : "Pause live receipt ticker"
          }
          onClick={() => setTickerPaused((paused) => !paused)}
        >
          {tickerPaused ? "Play" : "Pause"}
        </button>
      </section>

      {externalCreators.length > 0 && (
        <section
          className="external-strip"
          aria-label="Verified external creators"
        >
          <div className="external-strip-heading">
            <p className="eyebrow">verified external creators</p>
            <strong>{externalCreators.length}/3 live sources</strong>
          </div>
          <div className="external-strip-list">
            {externalCreators.map((source) => (
              <Link
                className="external-creator-link"
                href={`/sources/${source.id}`}
                key={source.id}
              >
                <span>{source.creator}</span>
                <strong>{source.title}</strong>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="how-it-works" id="how" aria-label="How it works">
        <ol className="step-grid">
          <li className="step-card">
            <span className="step-index" aria-hidden="true">
              01
            </span>
            <span className="step-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </span>
            <h3>Register your work</h3>
            <p>
              Add a link to one thing you&apos;ve made — an article, a photo, a
              video. Takes a minute, no account needed.
            </p>
          </li>
          <li className="step-card">
            <span className="step-index" aria-hidden="true">
              02
            </span>
            <span className="step-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v10M15.5 9.2c-.8-.8-2.1-1.2-3.5-1.2-1.8 0-3 .8-3 2s1.2 1.8 3 2 3 .8 3 2-1.2 2-3 2c-1.4 0-2.7-.4-3.5-1.2" />
              </svg>
            </span>
            <h3>AI cites it and pays you</h3>
            <p>
              When the answer agent uses your work, it pays you for that
              citation in USDC — automatically, every time.
            </p>
          </li>
          <li className="step-card">
            <span className="step-index" aria-hidden="true">
              03
            </span>
            <span className="step-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 7H5a2 2 0 0 1 0-4h13v4" />
                <path d="M4 6v12a2 2 0 0 0 2 2h14v-8" />
                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
              </svg>
            </span>
            <h3>Withdraw anytime</h3>
            <p>
              Your earnings collect in your wallet. Cash out whenever you like —
              and every payment is on the public record.
            </p>
          </li>
        </ol>
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
                <span className="creator-chip" aria-hidden="true">
                  {creator.creator
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => word[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <div className="creator-meta">
                  <strong>{creator.creator}</strong>
                  <span>
                    {creator.handle} / {shortWallet(creator.wallet)}
                  </span>
                </div>
                <div className="numeric-cell">
                  <strong className="num">
                    {formatDollars(creator.earnedAtomicUsdc)}
                  </strong>
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

        <div className="source-registry" id="register">
          <div className="panel-heading">
            <p className="eyebrow">get listed</p>
            <h3>Register your work</h3>
          </div>
          <form className="register-source-form" onSubmit={registerSource}>
            <div className="form-grid">
              <div>
                <label htmlFor="source-title">Title of your work</label>
                <input
                  id="source-title"
                  placeholder="Agent Payments, Explained"
                  value={sourceForm.title}
                  onChange={(event) =>
                    updateSourceForm("title", event.target.value)
                  }
                />
              </div>
              <div>
                <label htmlFor="source-creator">Your name</label>
                <input
                  id="source-creator"
                  placeholder="Ada Rivera"
                  value={sourceForm.creator}
                  onChange={(event) =>
                    updateSourceForm("creator", event.target.value)
                  }
                />
              </div>
              <div>
                <label htmlFor="source-price">Price per citation</label>
                <input
                  id="source-price"
                  inputMode="numeric"
                  placeholder="1500"
                  value={sourceForm.priceAtomicUsdc}
                  onChange={(event) =>
                    updateSourceForm("priceAtomicUsdc", event.target.value)
                  }
                />
                <small className="field-hint">
                  {Number(sourceForm.priceAtomicUsdc) > 0
                    ? `You'll earn ${formatDollars(
                        Number(sourceForm.priceAtomicUsdc),
                      )} each time the AI cites your work.`
                    : "How much you earn each time the AI cites your work."}
                </small>
              </div>
            </div>
            <label htmlFor="source-url">Link to your work</label>
            <input
              id="source-url"
              placeholder="https://yourblog.com/post"
              value={sourceForm.url}
              onChange={(event) => updateSourceForm("url", event.target.value)}
            />
            <label htmlFor="source-wallet">Payout wallet</label>
            <input
              id="source-wallet"
              placeholder="0x…"
              value={sourceForm.wallet}
              onChange={(event) =>
                updateSourceForm("wallet", event.target.value)
              }
            />
            <small className="field-hint">
              Optional. Paste an Ethereum-style wallet, or leave blank and
              Tollgate will create a custodial payout wallet when enabled.
            </small>
            <details className="form-advanced">
              <summary>More options — handle, topics, email, splits</summary>
              <label htmlFor="source-handle">Handle</label>
              <input
                id="source-handle"
                placeholder="@adawrites"
                value={sourceForm.handle}
                onChange={(event) =>
                  updateSourceForm("handle", event.target.value)
                }
              />
              <label htmlFor="source-summary">What it covers</label>
              <textarea
                id="source-summary"
                placeholder="One line on what it's about — helps the AI know when to cite you."
                value={sourceForm.summary}
                rows={3}
                onChange={(event) =>
                  updateSourceForm("summary", event.target.value)
                }
              />
              <label htmlFor="source-tags">Topics</label>
              <input
                id="source-tags"
                placeholder="agents, payments, x402"
                value={sourceForm.tags}
                onChange={(event) =>
                  updateSourceForm("tags", event.target.value)
                }
              />
              <label htmlFor="source-notify-email">Notification email</label>
              <input
                id="source-notify-email"
                placeholder="ada@example.com"
                value={sourceForm.notifyEmail}
                onChange={(event) =>
                  updateSourceForm("notifyEmail", event.target.value)
                }
              />
              <label htmlFor="source-contributors">Contributor splits</label>
              <input
                id="source-contributors"
                placeholder="0xabc...:7000, 0xdef...:3000"
                value={sourceForm.contributors}
                onChange={(event) =>
                  updateSourceForm("contributors", event.target.value)
                }
              />
            </details>
            <button
              type="submit"
              className="source-register-button"
              disabled={isRegisteringSource}
            >
              {isRegisteringSource ? "registering…" : "Register my work"}
            </button>
            <p className="status-line source-status" aria-live="polite">
              {sourceRegistrationStatus ||
                "Add one link to your work — you'll be paid whenever the AI cites it."}
            </p>
          </form>
          <div className="register-source-form">
            <label htmlFor="feed-url">Import your feed</label>
            <input
              id="feed-url"
              placeholder="https://yourblog.com"
              value={feedUrl}
              onChange={(event) => setFeedUrl(event.target.value)}
            />
            <button
              type="button"
              className="source-register-button"
              disabled={!feedUrl || isRegisteringSource}
              onClick={discoverFeed}
            >
              Find posts
            </button>
            {rssPosts.length > 0 && (
              <>
                <div className="source-list">
                  {rssPosts.map((post) => (
                    <label className="source-card" key={post.url}>
                      <input
                        type="checkbox"
                        checked={selectedRssUrls.has(post.url)}
                        onChange={(event) => {
                          setSelectedRssUrls((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(post.url);
                            else next.delete(post.url);
                            return next;
                          });
                        }}
                      />
                      <span>
                        <p>{post.title}</p>
                        <small>{post.url}</small>
                      </span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="source-register-button"
                  disabled={selectedRssUrls.size === 0 || isRegisteringSource}
                  onClick={registerSelectedFeedPosts}
                >
                  Register selected posts
                </button>
              </>
            )}
          </div>
        </div>
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
              `A paid answer costs ${formatDollars(
                settlementStatus?.paidQueryPriceAtomicUsdc ?? 10_000,
              )} and pays every creator it cites.`}
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
                  <strong>
                    {formatDollars(displayedQuery.totalAtomicUsdc)}
                  </strong>
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
                      {formatDollars(
                        displayedQuery.readerPayment.amountAtomicUsdc,
                      )}
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
                        {formatDollars(displayedBudget.sourceBudgetAtomicUsdc)}
                      </strong>
                    </div>
                    <div>
                      <span>agent spent</span>
                      <strong>
                        {formatDollars(displayedBudget.spentAtomicUsdc)}
                      </strong>
                    </div>
                    <div>
                      <span>remaining</span>
                      <strong>
                        {formatDollars(displayedBudget.remainingAtomicUsdc)}
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
                {displayedQuery.citations.map((citation) => (
                  <article className="citation-card" key={citation.sourceId}>
                    <div>
                      <p>{citation.title}</p>
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
      </section>

      <section className="metrics-band" aria-label="Ledger metrics">
        <Metric label="queries" value={stats.queryCount.toString()} />
        <Metric label="receipts" value={stats.receiptCount.toString()} />
        <Metric label="reader paid" value={formatDollars(stats.readerPaid)} />
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
                <strong>{formatDollars(receipt.amountAtomicUsdc)}</strong>
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
