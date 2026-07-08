"use client";

import { useState } from "react";

type CopySnippetProps = {
  label: string;
  value: string;
};

export function CopySnippet({ label, value }: CopySnippetProps) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="copy-snippet">
      <div className="copy-snippet-head">
        <span>{label}</span>
        <button
          type="button"
          className="source-register-button"
          onClick={copyValue}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <code>{value}</code>
    </div>
  );
}
