"use client";

import { useState } from "react";

export function LoginForm({ basePath }: { basePath: string }) {
  const [accountKey, setAccountKey] = useState("");
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("");
    try {
      const response = await fetch(`${basePath}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountKey: accountKey.trim() }),
      });
      if (response.ok) {
        window.location.href = `${basePath}/dashboard`;
        return;
      }
      const body = (await response.json().catch(() => null)) as {
        error?: unknown;
      } | null;
      setStatus(
        typeof body?.error === "string"
          ? body.error
          : "Account key was not accepted.",
      );
    } catch {
      setStatus("Network error - please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="registerForm" onSubmit={submit}>
      <label>
        Account key
        <input
          autoComplete="off"
          value={accountKey}
          onChange={(event) => setAccountKey(event.target.value)}
          placeholder="aptr_..."
          required
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? "Checking key..." : "Log in"}
      </button>
      {status && <p className="formStatus badText">{status}</p>}
    </form>
  );
}
