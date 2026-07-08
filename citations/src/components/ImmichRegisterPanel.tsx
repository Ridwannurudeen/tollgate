"use client";

import { useState, type FormEvent } from "react";

type ImmichRegistrationResponse = {
  registered?: {
    ownerId: string;
    displayName: string;
    wallet: string;
    approvalStatus: "pending" | "operator-approved" | "wallet-signed";
    custody?: "self" | "circle-w3s";
  };
  error?: string;
};

export function ImmichRegisterPanel() {
  const [ownerId, setOwnerId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [wallet, setWallet] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [registration, setRegistration] =
    useState<ImmichRegistrationResponse | null>(null);

  async function registerOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setStatus("Registering Immich owner mapping...");
    setRegistration(null);
    try {
      const response = await fetch("/aperture/api/creators", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerId,
          displayName,
          wallet: wallet || undefined,
        }),
      });
      const body = (await response.json()) as ImmichRegistrationResponse;
      if (!response.ok || !body.registered) {
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }
      setRegistration(body);
      setStatus("Owner mapping registered.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Immich registration failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="source-registry">
      <div className="panel-heading">
        <p className="eyebrow">immich owner setup</p>
        <h3>Map an owner to a wallet</h3>
      </div>
      {registration?.registered ? (
        <div className="registration-receipt" aria-live="polite">
          <div className="signature-stat registration-receipt-artifact">
            <span className="stamp">registered</span>
            <p className="eyebrow">owner payout mapping</p>
            <h3>{registration.registered.displayName}</h3>
            <div className="receipt-lines">
              <span className="receipt-line">
                <span>owner</span>
                <strong>{registration.registered.ownerId}</strong>
              </span>
              <span className="receipt-line">
                <span>wallet</span>
                <strong>{registration.registered.wallet}</strong>
              </span>
              <span className="receipt-line">
                <span>status</span>
                <strong>{registration.registered.approvalStatus}</strong>
              </span>
            </div>
          </div>
          <p className="status-line source-status">
            Immich archive downloads for this owner can now settle to the
            mapped wallet once the sidecar sees the download in the nginx access
            log.
          </p>
          <button
            type="button"
            className="source-register-button"
            onClick={() => {
              setRegistration(null);
              setStatus("");
            }}
          >
            Register another owner
          </button>
        </div>
      ) : (
        <form className="register-source-form" onSubmit={registerOwner}>
          <label htmlFor="immich-owner-id">Immich owner ID</label>
          <input
            id="immich-owner-id"
            placeholder="immich owner uuid"
            required
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
          />
          <label htmlFor="immich-display-name">Photographer display name</label>
          <input
            id="immich-display-name"
            placeholder="Jane Lens"
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <label htmlFor="immich-wallet">Payout wallet</label>
          <input
            id="immich-wallet"
            inputMode="text"
            pattern="^$|^0x[a-fA-F0-9]{40}$"
            placeholder="0x... or leave blank"
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
          />
          <small className="field-hint">
            Leave blank only when the Aperture service is configured to mint a
            custodial payout wallet.
          </small>
          <button
            type="submit"
            className="source-register-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? "registering..." : "Register owner mapping"}
          </button>
          <p className="status-line source-status" aria-live="polite">
            {status ||
              "Use the Immich owner/user ID that appears on the assets you want to monetize."}
          </p>
        </form>
      )}
    </div>
  );
}
