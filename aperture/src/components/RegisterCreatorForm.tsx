"use client";

import { useState } from "react";

type Registered = {
  displayName: string;
  wallet: string;
  approvalStatus: "pending" | "operator-approved" | "wallet-signed";
  custody?: "self" | "circle-w3s";
};

export function RegisterCreatorForm({ basePath }: { basePath: string }) {
  const [ownerId, setOwnerId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<Registered | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    setResult(null);
    try {
      const response = await fetch(`${basePath}/api/creators`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerId: ownerId.trim(),
          displayName: displayName.trim(),
          wallet: wallet.trim() || undefined,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.error ?? "Registration failed.");
        return;
      }
      setResult(body.registered);
      setStatus("");
    } catch {
      setStatus("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="registerForm" onSubmit={submit}>
      <label>
        Immich owner ID
        <input
          value={ownerId}
          onChange={(event) => setOwnerId(event.target.value)}
          placeholder="immich owner uuid"
          required
        />
      </label>
      <label>
        Display name
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
          (optional — leave blank and we create one for you)
        </span>
        <input
          value={wallet}
          onChange={(event) => setWallet(event.target.value)}
          placeholder="0x… or leave blank"
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? "Registering..." : "Register payout mapping"}
      </button>
      {status && <p className="formStatus">{status}</p>}
      {result && (
        <p className="formStatus">
          Registered {result.displayName} →{" "}
          {result.custody === "circle-w3s"
            ? "wallet minted for you"
            : "your wallet"}{" "}
          {result.wallet} / {result.approvalStatus}
        </p>
      )}
    </form>
  );
}
