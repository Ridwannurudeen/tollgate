"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CopyWallet } from "@/components/CopyWallet";
import { formatDollars, shortWallet } from "@/lib/format";
import type { CreatorSource } from "@/lib/types";

type SourceRegistryResponse = {
  source?: CreatorSource;
  sources: CreatorSource[];
  error?: string;
};

type DiscoveryResponse = {
  registered?: CreatorSource[];
  count?: number;
  error?: string;
  note?: string;
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

type FeedRegistrationSummary = {
  count: number;
  wallet: CreatorSource["wallet"];
  message: string;
  eyebrow: string;
  linkLabel: string;
  resetLabel: string;
};

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

export function RegisterPanel() {
  const [sourceForm, setSourceForm] =
    useState<SourceFormState>(EMPTY_SOURCE_FORM);
  const [sourceRegistrationStatus, setSourceRegistrationStatus] = useState("");
  const [registeredSource, setRegisteredSource] =
    useState<CreatorSource | null>(null);
  const [feedRegistration, setFeedRegistration] =
    useState<FeedRegistrationSummary | null>(null);
  const [discoveryUrl, setDiscoveryUrl] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [rssPosts, setRssPosts] = useState<RssImportPost[]>([]);
  const [selectedRssUrls, setSelectedRssUrls] = useState<Set<string>>(
    new Set(),
  );
  const [isRegisteringSource, setIsRegisteringSource] = useState(false);

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
      ...(contributors.length > 0 ? { contributors } : {}),
    };
  }

  async function registerSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRegisteringSource(true);
    setRegisteredSource(null);
    setFeedRegistration(null);
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
      setSourceForm(EMPTY_SOURCE_FORM);
      setRegisteredSource(body.source ?? null);
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
    setFeedRegistration(null);
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
    setRegisteredSource(null);
    setFeedRegistration(null);
    setSourceRegistrationStatus("Registering selected feed posts...");
    let registeredCount = 0;
    let firstError: string | null = null;
    let firstRegisteredSource: CreatorSource | null = null;
    try {
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
        if (body.source && firstRegisteredSource === null) {
          firstRegisteredSource = body.source;
        }
        registeredCount += 1;
      }
      const message = firstError
        ? `Registered ${registeredCount} of ${selected.length} feed post(s), then stopped: ${firstError}`
        : `Registered ${registeredCount} feed post(s).`;
      setSourceRegistrationStatus(message);
      if (registeredCount > 0 && firstRegisteredSource) {
        setFeedRegistration({
          count: registeredCount,
          wallet: firstRegisteredSource.wallet,
          message,
          eyebrow: "feed import",
          linkLabel: "View earnings board",
          resetLabel: "Import another feed",
        });
      }
    } catch (error) {
      const message =
        registeredCount > 0
          ? `Registered ${registeredCount} of ${selected.length} feed post(s), then failed: ${
              error instanceof Error ? error.message : "Feed import failed."
            }`
          : error instanceof Error
            ? error.message
            : "Feed import failed.";
      setSourceRegistrationStatus(message);
      if (registeredCount > 0 && firstRegisteredSource) {
        setFeedRegistration({
          count: registeredCount,
          wallet: firstRegisteredSource.wallet,
          message,
          eyebrow: "feed import",
          linkLabel: "View earnings board",
          resetLabel: "Import another feed",
        });
      }
    } finally {
      setIsRegisteringSource(false);
    }
  }

  async function discoverSite() {
    setIsRegisteringSource(true);
    setRegisteredSource(null);
    setFeedRegistration(null);
    setSourceRegistrationStatus("Looking for Tollgate declaration...");
    try {
      const response = await fetch("/api/sources/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: discoveryUrl }),
      });
      const body = (await response.json()) as DiscoveryResponse;
      if (!response.ok) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      const registered = body.registered ?? [];
      const count = body.count ?? registered.length;
      if (registered.length === 1 && !body.error) {
        setRegisteredSource(registered[0]);
        setSourceRegistrationStatus(
          body.note ?? "Discovered source registered.",
        );
        return;
      }
      if (registered.length > 0) {
        setFeedRegistration({
          count,
          wallet: registered[0].wallet,
          message:
            body.error ??
            `${count} discovered source(s) registered. Verify ownership to leave probation.`,
          eyebrow: "site discovery",
          linkLabel: "View earnings board",
          resetLabel: "Discover another site",
        });
        setSourceRegistrationStatus(
          body.error ??
            `${count} discovered source(s) registered. Verify ownership to leave probation.`,
        );
        return;
      }
      setSourceRegistrationStatus(body.error ?? "No sources registered.");
    } catch (error) {
      setSourceRegistrationStatus(
        error instanceof Error ? error.message : "Site discovery failed.",
      );
    } finally {
      setIsRegisteringSource(false);
    }
  }

  return (
    <div className="source-registry" id="register">
      <div className="panel-heading">
        <p className="eyebrow">get listed</p>
        <h3>Register your work</h3>
      </div>
      {registeredSource ? (
        <div className="registration-receipt" aria-live="polite">
          <div className="signature-stat registration-receipt-artifact">
            <span className="stamp">REGISTERED</span>
            <p className="eyebrow">you're listed</p>
            <h3>{registeredSource.title}</h3>
            <div className="receipt-lines">
              <span className="receipt-line">
                <span>creator</span>
                <strong>{registeredSource.creator}</strong>
              </span>
              <span className="receipt-line">
                <span>price</span>
                <strong>
                  {formatDollars(registeredSource.priceAtomicUsdc)} / citation
                </strong>
              </span>
              <span className="receipt-line">
                <span>wallet</span>
                <strong>
                  <CopyWallet address={registeredSource.wallet} />
                </strong>
              </span>
            </div>
          </div>
          <p className="status-line source-status">
            {registeredSource.custody === "circle-w3s"
              ? `We created a custodial payout wallet for you: ${shortWallet(
                  registeredSource.wallet,
                )}.`
              : `Payouts go to ${shortWallet(registeredSource.wallet)}.`}
          </p>
          <p className="hero-text">
            Verified creators leave probation and get paid in full - takes 30
            seconds with a meta tag or DNS record.
          </p>
          <div className="hero-cta registration-actions">
            <Link
              className="cta-primary"
              href={`/sources/${registeredSource.id}#verify`}
            >
              Verify you own this →
            </Link>
            <Link
              className="cta-secondary"
              href={`/sources/${registeredSource.id}`}
            >
              View your source page
            </Link>
          </div>
          <ol className="registration-next-list">
            <li>Verify ownership to leave probation.</li>
            <li>
              The answer agent cites you when relevant, then pays per citation
              in USDC.
            </li>
            <li>
              Withdraw anytime; every payment is an on-chain receipt on{" "}
              <Link
                className="inline-link"
                href={`/creators/${registeredSource.wallet}`}
              >
                your earnings board
              </Link>
              .
            </li>
          </ol>
          <button
            type="button"
            className="source-register-button"
            onClick={() => {
              setRegisteredSource(null);
              setSourceRegistrationStatus("");
            }}
          >
            Register another
          </button>
        </div>
      ) : (
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
            type="url"
            placeholder="https://yourblog.com/post"
            value={sourceForm.url}
            onChange={(event) => updateSourceForm("url", event.target.value)}
          />
          <label htmlFor="source-wallet">Payout wallet</label>
          <input
            id="source-wallet"
            placeholder="0x..."
            value={sourceForm.wallet}
            onChange={(event) => updateSourceForm("wallet", event.target.value)}
          />
          <small className="field-hint">
            <strong>No wallet? Leave this blank.</strong> Tollgate creates a
            custodial payout wallet for you automatically. Or paste any
            Ethereum-style wallet (0x...) to receive payouts directly.
          </small>
          <details className="form-advanced">
            <summary>More options - handle, topics, email, splits</summary>
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
              placeholder="One line on what it's about - helps the AI know when to cite you."
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
              onChange={(event) => updateSourceForm("tags", event.target.value)}
            />
            <label htmlFor="source-notify-email">Notification email</label>
            <input
              id="source-notify-email"
              type="email"
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
            {isRegisteringSource ? "registering..." : "Register my work"}
          </button>
          <p className="status-line source-status" aria-live="polite">
            {sourceRegistrationStatus ||
              "Add one link to your work - you'll be paid whenever the AI cites it."}
          </p>
        </form>
      )}
      <div className="register-source-form">
        <label htmlFor="discovery-url">
          Already have a <code>tollgate.json</code> or a{" "}
          <code>&lt;meta name=&quot;tollgate&quot;&gt;</code> tag?
        </label>
        <input
          id="discovery-url"
          type="url"
          placeholder="https://yourblog.com"
          value={discoveryUrl}
          onChange={(event) => setDiscoveryUrl(event.target.value)}
        />
        <small className="field-hint">
          Paste your homepage URL. Tollgate checks the public declaration,
          registers up to 20 sources, and keeps them probationary until you
          verify ownership.{" "}
          <Link className="inline-link" href="/docs/SPEC-DISCOVERY.md">
            Declaration examples
          </Link>
        </small>
        <button
          type="button"
          className="source-register-button"
          disabled={!discoveryUrl || isRegisteringSource}
          onClick={discoverSite}
        >
          {isRegisteringSource ? "discovering..." : "Discover my site"}
        </button>
      </div>
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
        {feedRegistration && (
          <div className="feed-registration-receipt" aria-live="polite">
            <div>
              <p className="eyebrow">{feedRegistration.eyebrow}</p>
              <h3>
                Registered {feedRegistration.count}{" "}
                {feedRegistration.count === 1 ? "source" : "sources"}
              </h3>
            </div>
            <p className="status-line">{feedRegistration.message}</p>
            <div className="hero-cta registration-actions">
              <Link
                className="receipt-link"
                href={`/creators/${feedRegistration.wallet}`}
              >
                {feedRegistration.linkLabel}
              </Link>
              <button
                type="button"
                className="source-register-button"
                onClick={() => {
                  setFeedRegistration(null);
                  setSourceRegistrationStatus("");
                }}
              >
                {feedRegistration.resetLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
