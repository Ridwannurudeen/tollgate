"use client";

import { useState } from "react";

type LinkRegistrationResult = {
  shareUrl: string;
  accountKey?: string;
  link: {
    id: string;
    title: string;
    priceAtomicUsdc: number;
    hasPreview?: boolean;
  };
  registered: {
    ownerId: string;
    displayName: string;
    wallet: string;
    approvalStatus: string;
    custody?: "self" | "circle-w3s";
  };
};

export function LinkRegistrationForm({ basePath }: { basePath: string }) {
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [wallet, setWallet] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<LinkRegistrationResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    setResult(null);
    try {
      const response = await fetch(`${basePath}/api/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUrl: sourceUrl.trim(),
          title: title.trim(),
          displayName: displayName.trim(),
          wallet: wallet.trim() || undefined,
          email: email.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.error ?? "Photo link registration failed.");
        return;
      }
      setResult(body);
    } catch {
      setStatus("Network error - please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyShareUrl() {
    if (!result) return;
    await navigator.clipboard.writeText(result.shareUrl);
    setStatus("Share link copied.");
  }

  async function copyAccountKey() {
    if (!result?.accountKey) return;
    await navigator.clipboard.writeText(result.accountKey);
    setStatus("Account key copied.");
  }

  return (
    <form className="registerForm" onSubmit={submit}>
      <label>
        Photo URL
        <input
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://example.com/photo.jpg"
          required
          type="url"
        />
      </label>
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Morning at Surulere"
          required
        />
      </label>
      <label>
        Photographer name
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Jane Lens"
          required
        />
      </label>
      <label>
        Email{" "}
        <span className="hint">
          (recommended - so you can log in with just a link)
        </span>
        <input
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="jane@example.com"
          type="email"
        />
      </label>
      <label>
        Payout wallet{" "}
        <span className="hint">
          (optional - leave blank and we create one for you)
        </span>
        <input
          value={wallet}
          onChange={(event) => setWallet(event.target.value)}
          placeholder="0x... or leave blank"
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? "Checking photo..." : "Create gated link"}
      </button>
      {status && <p className="formStatus">{status}</p>}
      {result && (
        <div className="linkSuccess" aria-live="polite">
          <p className="eyebrow">Share this link</p>
          {result.link.hasPreview && (
            <figure className="previewFrame compactPreview">
              <img
                alt={`Watermarked preview of ${result.link.title}`}
                src={`${basePath}/link/${result.link.id}/preview`}
              />
              <figcaption>
                Buyers see this watermarked preview before unlocking the full
                original.
              </figcaption>
            </figure>
          )}
          <input readOnly value={result.shareUrl} />
          <div className="actions compactActions">
            <button type="button" onClick={copyShareUrl}>
              Copy link
            </button>
            <a className="button" href={result.shareUrl}>
              Open gated page
            </a>
          </div>
          <p className="formStatus">
            Registered {result.registered.displayName} to{" "}
            {result.registered.custody === "circle-w3s"
              ? "a wallet created for you"
              : "your wallet"}{" "}
            {result.registered.wallet}.
          </p>
          {result.accountKey && (
            <div className="accountKeyBox">
              <p className="eyebrow">Save your account key</p>
              <p>
                Backup key - save it if you want a non-email login. You can
                also use your email to receive a private login link.
              </p>
              <input readOnly value={result.accountKey} />
              <div className="actions compactActions">
                <button type="button" onClick={copyAccountKey}>
                  Copy account key
                </button>
                <a className="button" href={`${basePath}/dashboard`}>
                  Open dashboard
                </a>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
