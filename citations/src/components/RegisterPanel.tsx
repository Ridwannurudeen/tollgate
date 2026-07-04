"use client";

import { useState, type FormEvent } from "react";
import { formatDollars } from "@/lib/format";
import type { CreatorSource } from "@/lib/types";

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
          Paste an EVM payout wallet. When custodial onboarding is enabled,
          Tollgate can mint a Circle W3S wallet for creators without one.
        </small>
        <details className="form-advanced">
          <summary>More options - handle, topics, email, splits</summary>
          <label htmlFor="source-handle">Handle</label>
          <input
            id="source-handle"
            placeholder="@adawrites"
            value={sourceForm.handle}
            onChange={(event) => updateSourceForm("handle", event.target.value)}
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
  );
}
