"use client";

import { useState } from "react";

type Props = {
  sourceId: string;
  token: string | null;
  verified: boolean;
};

export function SourceVerifyPanel({ sourceId, token, verified }: Props) {
  const [status, setStatus] = useState("");

  async function check(method: "meta-tag" | "dns-txt") {
    setStatus("Checking ownership...");
    try {
      const response = await fetch(`/api/sources/${sourceId}/verify`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? `HTTP ${response.status}`);
      setStatus("Source verified.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Verification failed.",
      );
    }
  }

  if (verified) return null;

  return (
    <section className="receipt-context profile-section" id="verify">
      <div className="panel-heading">
        <p className="eyebrow">verify ownership</p>
        <h3>Wallet-free proof</h3>
      </div>
      {token ? (
        <>
          <div className="evidence-grid">
            <div className="evidence-row">
              <span>meta tag</span>
              <strong>{`<meta name="tollgate-verification" content="${token}">`}</strong>
            </div>
            <div className="evidence-row">
              <span>DNS TXT</span>
              <strong>{`tollgate-verify=${token}`}</strong>
            </div>
          </div>
          <div className="hero-cta">
            <button
              type="button"
              className="source-register-button"
              onClick={() => check("meta-tag")}
            >
              Check meta tag
            </button>
            <button
              type="button"
              className="source-register-button"
              onClick={() => check("dns-txt")}
            >
              Check DNS
            </button>
          </div>
        </>
      ) : (
        <p className="hero-text">Verification tokens are not configured.</p>
      )}
      <p className="status-line" aria-live="polite">
        {status || "Verification releases escrowed payouts for this source."}
      </p>
    </section>
  );
}
