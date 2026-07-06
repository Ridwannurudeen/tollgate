"use client";

import React from "react";
import { useState } from "react";

export function CopyButton({
  value,
  children = "Copy",
}: {
  value: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = value.startsWith("/")
      ? `${window.location.origin}${value}`
      : value;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button className="button" type="button" onClick={copy}>
      {copied ? "Copied" : children}
    </button>
  );
}

export function LogoutButton({ basePath }: { basePath: string }) {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    await fetch(`${basePath}/api/session`, { method: "DELETE" }).catch(
      () => null,
    );
    window.location.href = `${basePath}/login`;
  }

  return (
    <button
      className="button"
      type="button"
      onClick={logout}
      disabled={pending}
    >
      {pending ? "Logging out" : "Log out"}
    </button>
  );
}
