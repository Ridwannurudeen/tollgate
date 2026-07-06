"use client";

import React from "react";
import { useState } from "react";

type AddEmailFormProps = {
  basePath: string;
};

export function AddEmailForm({ basePath }: AddEmailFormProps) {
  const [email, setEmail] = useState("");
  const [savedEmail, setSavedEmail] = useState("");
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);

  async function addEmail(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setStatus("");
    try {
      const response = await fetch(`${basePath}/api/account/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body = (await response.json().catch(() => null)) as {
        email?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok) {
        setStatus(
          typeof body?.error === "string" ? body.error : "Email update failed.",
        );
        return;
      }
      if (typeof body?.email === "string") {
        setSavedEmail(body.email);
      }
    } catch {
      setStatus("Network error - please try again.");
    } finally {
      setPending(false);
    }
  }

  if (savedEmail) return <strong>{savedEmail}</strong>;

  return (
    <form className="registerForm compactEmailForm" onSubmit={addEmail}>
      <label>
        Recovery email
        <span className="hint">
          Save an email to receive private login links for this account.
        </span>
        <input
          autoComplete="email"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Saving" : "Save"}
      </button>
      {status && <p className="formStatus badText">{status}</p>}
    </form>
  );
}
