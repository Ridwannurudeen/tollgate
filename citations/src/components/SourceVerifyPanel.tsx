"use client";

import { useState } from "react";

type Props = {
  sourceId: string;
  token: string | null;
  verified: boolean;
  claimed: boolean;
};

export function SourceVerifyPanel({
  sourceId,
  token,
  verified,
  claimed,
}: Props) {
  const [status, setStatus] = useState("");
  const [claimChecked, setClaimChecked] = useState(false);
  const [claimedStatus, setClaimedStatus] = useState(claimed);

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

  async function claim() {
    if (!claimChecked) {
      setStatus("Confirm the creator attestation before claiming.");
      return;
    }
    setStatus("Recording creator claim...");
    try {
      const response = await fetch(`/api/sources/${sourceId}/verify`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "creator-claimed", attest: true }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? `HTTP ${response.status}`);
      setClaimedStatus(true);
      setStatus("Claimed - self-attested.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Claim failed.");
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
      <div className="claim-box">
        <p>
          Third-party-hosted work can be claimed without a wallet or domain
          edit. This releases escrowed payouts, but it is only a
          self-declaration. Domain or ORCID proof is still the stronger
          Verified path.
        </p>
        <label>
          <input
            checked={claimChecked}
            disabled={claimedStatus}
            onChange={(event) => setClaimChecked(event.target.checked)}
            type="checkbox"
          />
          <span>I certify I am the creator/owner of this work.</span>
        </label>
        <button
          type="button"
          className="source-register-button claim-button"
          disabled={claimedStatus}
          onClick={claim}
        >
          {claimedStatus ? "Creator-claimed" : "Claim as creator"}
        </button>
      </div>
      <p className="status-line" aria-live="polite">
        {status ||
          (claimedStatus
            ? "Claimed - self-attested, not independently verified."
            : "Verification or creator claim releases escrowed payouts for this source.")}
      </p>
    </section>
  );
}
