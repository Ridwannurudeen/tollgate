"use client";

import { useState } from "react";

type LinkRegistrationResult = {
  shareUrl: string;
  link: {
    id: string;
    title: string;
    priceAtomicUsdc: number;
  };
  registered: {
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
        </div>
      )}
    </form>
  );
}
