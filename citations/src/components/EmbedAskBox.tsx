"use client";

import { useState } from "react";
import { formatDollars, shortHash } from "@/lib/format";
import type { SettlementResult } from "@/lib/types";

type Props = {
  creator: string;
};

export function EmbedAskBox({ creator }: Props) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<SettlementResult | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  async function ask() {
    setLoading(true);
    setStatus("settling");
    try {
      const response = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, creator }),
      });
      const body = (await response.json()) as
        | SettlementResult
        | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in body ? body.error : `HTTP ${response.status}`,
        );
      }
      setResult(body as SettlementResult);
      setStatus("settled");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "query failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="embed-shell">
      <div className="embed-head">
        <span>Tollgate</span>
        <strong>Paid answers</strong>
      </div>
      <textarea
        aria-label="Question"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        placeholder="Ask a question about this publisher's work"
        rows={3}
      />
      <button type="button" disabled={loading || !question.trim()} onClick={ask}>
        {loading ? "settling..." : "Ask"}
      </button>
      <p aria-live="polite">{status}</p>
      {result && (
        <section className="embed-answer">
          <strong>{result.query.answer}</strong>
          <span>
            {result.receipts.length} citation receipts /{" "}
            {formatDollars(result.query.totalAtomicUsdc)}
          </span>
          <a href={`/answers/${result.query.id}`} target="_blank">
            {shortHash(result.query.queryHash)}
          </a>
        </section>
      )}
    </main>
  );
}
