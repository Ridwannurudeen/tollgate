"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatUsdc } from "@/lib/format";

type Props = {
  sourceId: string;
  token: string | null;
  verified: boolean;
  escrowedAtomicUsdc: number;
  escrowedCitationCount: number;
};

export function SourceVerifyPanel({
  sourceId,
  token,
  verified,
  escrowedAtomicUsdc,
  escrowedCitationCount,
}: Props) {
  const router = useRouter();
  const [status, setStatus] = useState("");

  async function check(method: "meta-tag" | "dns-txt") {
    setStatus("Checking ownership...");
    try {
      const response = await fetch(`/api/sources/${sourceId}/verify`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const body = (await response.json()) as {
        error?: string;
        escrowRelease?: { released: boolean; amountAtomicUsdc: number };
      };
      if (!response.ok)
        throw new Error(body.error ?? `HTTP ${response.status}`);
      setStatus(
        body.escrowRelease?.released
          ? `Source verified. Released ${formatUsdc(body.escrowRelease.amountAtomicUsdc)} USDC.`
          : "Source verified.",
      );
      router.refresh();
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
        {status ||
          (escrowedAtomicUsdc > 0
            ? `${formatUsdc(escrowedAtomicUsdc)} USDC is held in escrow across ${escrowedCitationCount} citation${escrowedCitationCount === 1 ? "" : "s"}. Verifying ownership releases it to this source's wallet.`
            : "Meta-tag or DNS ownership verification releases escrowed payouts for this source.")}
      </p>
    </section>
  );
}
