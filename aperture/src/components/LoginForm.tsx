"use client";

import { useState } from "react";

export function LoginForm({ basePath }: { basePath: string }) {
  const [email, setEmail] = useState("");
  const [accountKey, setAccountKey] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [keyStatus, setKeyStatus] = useState("");
  const [emailSubmitting, setEmailSubmitting] = useState(false);
  const [keySubmitting, setKeySubmitting] = useState(false);

  async function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    setEmailSubmitting(true);
    setEmailStatus("");
    setKeyStatus("");
    try {
      const response = await fetch(`${basePath}/api/login-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (response.status === 429) {
        const body = (await response.json().catch(() => null)) as {
          error?: unknown;
        } | null;
        setEmailStatus(
          typeof body?.error === "string"
            ? body.error
            : "Too many login-link requests. Wait a minute and retry.",
        );
        return;
      }
      setEmailStatus("If that email can receive mail, a link is on its way.");
    } catch {
      setEmailStatus("Network error - please try again.");
    } finally {
      setEmailSubmitting(false);
    }
  }

  async function submitKey(event: React.FormEvent) {
    event.preventDefault();
    setKeySubmitting(true);
    setEmailStatus("");
    setKeyStatus("");
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
      setKeyStatus(
        typeof body?.error === "string"
          ? body.error
          : "Account key was not accepted.",
      );
    } catch {
      setKeyStatus("Network error - please try again.");
    } finally {
      setKeySubmitting(false);
    }
  }

  return (
    <div className="loginStack">
      <form className="registerForm" onSubmit={submitEmail}>
        <label>
          Email
          <input
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="jane@example.com"
            required
            type="email"
          />
        </label>
        <button type="submit" disabled={emailSubmitting}>
          {emailSubmitting ? "Sending link..." : "Send link"}
        </button>
        {emailStatus && <p className="formStatus">{emailStatus}</p>}
      </form>

      <details className="keyLogin">
        <summary>Have an account key instead?</summary>
        <form className="registerForm" onSubmit={submitKey}>
          <label>
            Backup account key
            <input
              autoComplete="off"
              value={accountKey}
              onChange={(event) => setAccountKey(event.target.value)}
              placeholder="aptr_..."
              required
            />
          </label>
          <button type="submit" disabled={keySubmitting}>
            {keySubmitting ? "Checking key..." : "Log in with key"}
          </button>
          {keyStatus && <p className="formStatus badText">{keyStatus}</p>}
        </form>
      </details>
    </div>
  );
}
