"use client";

import { useState, type FormEvent } from "react";

type JellyfinRegistrationResponse = {
  operator?: {
    id: string;
    operatorName: string;
    itemIds: string[];
    registeredAt: string;
  };
  mapping?: {
    itemId: string;
    title?: string;
    displayName: string;
    wallet: string;
    priceAtomicUsdcPerMinute?: number;
    approvalStatus?: string;
  };
  apiKey?: string;
  webhookUrl?: string;
  error?: string;
};

export function JellyfinRegisterPanel() {
  const [operatorName, setOperatorName] = useState("");
  const [itemId, setItemId] = useState("");
  const [title, setTitle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [wallet, setWallet] = useState("");
  const [priceAtomicUsdcPerMinute, setPriceAtomicUsdcPerMinute] =
    useState("2500");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [registration, setRegistration] =
    useState<JellyfinRegistrationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function registerOperator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setCopied(false);
    setStatus("Registering Jellyfin webhook key...");
    setRegistration(null);
    try {
      const response = await fetch("/jellyfin/api/operators/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operatorName,
          itemId,
          title: title || undefined,
          displayName,
          wallet,
          priceAtomicUsdcPerMinute: Number(priceAtomicUsdcPerMinute),
        }),
      });
      const body = (await response.json()) as JellyfinRegistrationResponse;
      if (!response.ok || !body.apiKey || !body.operator || !body.mapping) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setRegistration(body);
      setStatus("Webhook key created. Copy it before leaving this page.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Jellyfin registration failed.",
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
        <p className="eyebrow">jellyfin server setup</p>
        <h3>Register a webhook key</h3>
      </div>
      {registration?.apiKey && registration.operator && registration.mapping ? (
        <div className="registration-receipt" aria-live="polite">
          <div className="signature-stat registration-receipt-artifact">
            <span className="stamp">registered</span>
            <p className="eyebrow">webhook API key</p>
            <h3>{registration.operator.operatorName}</h3>
            <div className="receipt-lines">
              <span className="receipt-line">
                <span>item</span>
                <strong>{registration.mapping.itemId}</strong>
              </span>
              <span className="receipt-line">
                <span>creator</span>
                <strong>{registration.mapping.displayName}</strong>
              </span>
              <span className="receipt-line">
                <span>wallet</span>
                <strong>{registration.mapping.wallet}</strong>
              </span>
            </div>
          </div>
          <label htmlFor="jellyfin-api-key">Copy this key now</label>
          <input
            id="jellyfin-api-key"
            readOnly
            value={registration.apiKey}
            onFocus={(event) => event.currentTarget.select()}
          />
          <p className="status-line source-status">
            This key is shown once. Add it to the Jellyfin Webhook destination
            as header <code>X-Tollgate-Key</code>.
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
              Register another item
            </button>
          </div>
          <ol className="registration-next-list">
            <li>
              Destination URL:{" "}
              <code>
                {registration.webhookUrl ??
                  "https://tollgate.gudman.xyz/jellyfin/api/webhooks/jellyfin"}
              </code>
            </li>
            <li>
              Header name: <code>X-Tollgate-Key</code>
            </li>
            <li>
              Header value: paste the one-time key shown above before leaving.
            </li>
          </ol>
        </div>
      ) : (
        <form className="register-source-form" onSubmit={registerOperator}>
          <label htmlFor="jellyfin-operator-name">Server name</label>
          <input
            id="jellyfin-operator-name"
            placeholder="Studio Jellyfin"
            required
            value={operatorName}
            onChange={(event) => setOperatorName(event.target.value)}
          />
          <label htmlFor="jellyfin-item-id">Jellyfin item ID</label>
          <input
            id="jellyfin-item-id"
            placeholder="movie-or-episode-guid"
            required
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
          />
          <label htmlFor="jellyfin-title">Title</label>
          <input
            id="jellyfin-title"
            placeholder="Independent Film"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label htmlFor="jellyfin-display-name">Creator display name</label>
          <input
            id="jellyfin-display-name"
            placeholder="Studio Creator"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <label htmlFor="jellyfin-wallet">Payout wallet</label>
          <input
            id="jellyfin-wallet"
            inputMode="text"
            pattern="^0x[a-fA-F0-9]{40}$"
            placeholder="0x..."
            required
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
          />
          <label htmlFor="jellyfin-price">Atomic USDC per watched minute</label>
          <input
            id="jellyfin-price"
            inputMode="numeric"
            pattern="[0-9]+"
            placeholder="2500"
            required
            value={priceAtomicUsdcPerMinute}
            onChange={(event) =>
              setPriceAtomicUsdcPerMinute(event.target.value)
            }
          />
          <small className="field-hint">
            `2500` is 0.0025 USDC per billable watched minute.
          </small>
          <button
            type="submit"
            className="source-register-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? "registering..." : "Create webhook API key"}
          </button>
          <p className="status-line source-status" aria-live="polite">
            {status ||
              "Register one Jellyfin media item and the wallet that should receive watched-minute payouts."}
          </p>
        </form>
      )}
    </div>
  );
}
