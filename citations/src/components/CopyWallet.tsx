"use client";

import { useState } from "react";
import { shortWallet } from "@/lib/format";

type Props = {
  address: string;
  truncate?: boolean;
};

export function CopyWallet({ address, truncate = false }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1400);
    }
  }

  return (
    <span className="copy-wallet">
      <span className="copy-wallet-address">
        {truncate ? shortWallet(address) : address}
      </span>
      <button
        aria-label="Copy wallet address"
        className="wallet-button copy-wallet-button"
        onClick={copyAddress}
        type="button"
      >
        {copyState === "copied"
          ? "Copied"
          : copyState === "failed"
            ? "Failed"
            : "Copy"}
      </button>
    </span>
  );
}
