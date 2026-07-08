"use client";

import { useState, type FormEvent } from "react";

type RegistrationResponse = {
  site?: {
    id: string;
    siteUrl: string;
    creatorWallet: string;
    registeredAt: string;
  };
  apiKey?: string;
  error?: string;
};

function apiKeySeed(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function WordPressRegisterPanel() {
  const [siteUrl, setSiteUrl] = useState("");
  const [creatorWallet, setCreatorWallet] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [registration, setRegistration] =
    useState<RegistrationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function registerSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setCopied(false);
    setStatus("Registering WordPress site...");
    setRegistration(null);
    try {
      const response = await fetch("/api/wordpress/sites/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          siteUrl,
          creatorWallet,
          apiKeySeed: apiKeySeed(),
        }),
      });
      const body = (await response.json()) as RegistrationResponse;
      if (!response.ok || !body.apiKey || !body.site) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setRegistration(body);
      setStatus("Site registered. Copy the key before leaving this page.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "WordPress site registration failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function copyKey() {
    if (!registration?.apiKey) return;
    try {
      await navigator.clipboard.writeText(registration.apiKey);
      setCopied(true);
      setStatus("API key copied.");
    } catch {
      setStatus("Copy failed. Select the key field and copy it manually.");
    }
  }

  return (
    <div className="source-registry">
      <div className="panel-heading">
        <p className="eyebrow">wordpress publisher setup</p>
        <h3>Register your site</h3>
      </div>
      {registration?.apiKey && registration.site ? (
        <div className="registration-receipt" aria-live="polite">
          <div className="signature-stat registration-receipt-artifact">
            <span className="stamp">registered</span>
            <p className="eyebrow">site API key</p>
            <h3>{new URL(registration.site.siteUrl).hostname}</h3>
            <div className="receipt-lines">
              <span className="receipt-line">
                <span>site</span>
                <strong>{registration.site.siteUrl}</strong>
              </span>
              <span className="receipt-line">
                <span>wallet</span>
                <strong>{registration.site.creatorWallet}</strong>
              </span>
            </div>
          </div>
          <label htmlFor="wordpress-api-key">Copy this key now</label>
          <input
            id="wordpress-api-key"
            readOnly
            value={registration.apiKey}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="status-line source-status">
            This key is shown once. Paste it into Settings -&gt; Tollgate in
            WordPress before leaving this page.
          </p>
          <div className="hero-cta registration-actions">
            <button
              type="button"
              className="source-register-button"
              onClick={copyKey}
            >
              {copied ? "Copied" : "Copy API key"}
            </button>
            <button
              type="button"
              className="source-register-button"
              onClick={() => {
                setRegistration(null);
                setStatus("");
              }}
            >
              Register another site
            </button>
          </div>
        </div>
      ) : (
        <form className="register-source-form" onSubmit={registerSite}>
          <label htmlFor="wordpress-site-url">WordPress site URL</label>
          <input
            id="wordpress-site-url"
            type="url"
            placeholder="https://your-site.com"
            required
            value={siteUrl}
            onChange={(event) => setSiteUrl(event.target.value)}
          />
          <label htmlFor="wordpress-creator-wallet">Payout wallet</label>
          <input
            id="wordpress-creator-wallet"
            inputMode="text"
            pattern="^0x[a-fA-F0-9]{40}$"
            placeholder="0x..."
            required
            value={creatorWallet}
            onChange={(event) => setCreatorWallet(event.target.value)}
          />
          <small className="field-hint">
            This is where Tollgate routes USDC when readers unlock gated posts
            from this WordPress site.
          </small>
          <button
            type="submit"
            className="source-register-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? "registering..." : "Create site API key"}
          </button>
          <p className="status-line source-status" aria-live="polite">
            {status ||
              "You only need your public site URL and the wallet that should receive payouts."}
          </p>
        </form>
      )}
    </div>
  );
}
