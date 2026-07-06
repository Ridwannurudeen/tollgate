"use client";

import React from "react";
import { useState } from "react";

type LinkedWalletsFormProps = {
  basePath: string;
  linkedWallets: string[];
};

export function LinkedWalletsForm({
  basePath,
  linkedWallets,
}: LinkedWalletsFormProps) {
  const [wallet, setWallet] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  async function mutate(method: "POST" | "DELETE", targetWallet: string) {
    setPending(targetWallet);
    setStatus("");
    try {
      const response = await fetch(`${basePath}/api/account/wallets`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet: targetWallet }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      if (!response.ok) {
        setStatus(
          typeof body?.error === "string"
            ? body.error
            : "Wallet update failed.",
        );
        return;
      }
      window.location.reload();
    } catch {
      setStatus("Network error - please try again.");
    } finally {
      setPending(null);
    }
  }

  async function addWallet(event: React.FormEvent) {
    event.preventDefault();
    await mutate("POST", wallet.trim());
  }

  return (
    <div className="linkedWallets">
      <form className="registerForm compactWalletForm" onSubmit={addWallet}>
        <label>
          Wallet to track
          <span className="hint">
            Add the public wallet you use for Tollgate citations. Payouts still
            go to that wallet on-chain.
          </span>
          <input
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
            placeholder="0x..."
            required
          />
        </label>
        <button type="submit" disabled={pending !== null}>
          {pending === wallet.trim() ? "Adding" : "Add wallet"}
        </button>
      </form>
      {linkedWallets.length > 0 && (
        <div className="walletPills">
          {linkedWallets.map((linkedWallet) => (
            <span key={linkedWallet}>
              {linkedWallet}
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  mutate("DELETE", linkedWallet);
                }}
              >
                Remove
              </button>
            </span>
          ))}
        </div>
      )}
      {status && <p className="formStatus badText">{status}</p>}
    </div>
  );
}
