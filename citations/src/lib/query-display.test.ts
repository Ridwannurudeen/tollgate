import { describe, expect, it } from "vitest";
import {
  agentTraceLabel,
  displayAgentRationale,
  latestShowcaseQuery,
} from "./query-display";
import type { QueryRecord } from "./types";

function query(
  id: string,
  createdAt: string,
  agentMode?: QueryRecord["agentMode"],
  agentModel?: string,
): QueryRecord {
  return {
    id,
    question: `Question ${id}`,
    answer: `Answer ${id}`,
    queryHash: `query-${id}`,
    answerHash: `answer-${id}`,
    totalAtomicUsdc: 0,
    citations: [],
    agentMode,
    agentModel,
    receiptHashes: [],
    createdAt,
  };
}

describe("query display helpers", () => {
  it("prefers the most recent LLM query over a newer deterministic fallback", () => {
    const selected = latestShowcaseQuery([
      query("deterministic-new", "2026-07-05T12:00:00.000Z", "deterministic"),
      query("llm-old", "2026-07-05T11:59:00.000Z", "llm", "gpt-test"),
    ]);

    expect(selected?.id).toBe("llm-old");
  });

  it("falls back to the most recent query when no LLM query exists", () => {
    const selected = latestShowcaseQuery([
      query("older", "2026-07-05T10:00:00.000Z", "deterministic"),
      query("newer", "2026-07-05T11:00:00.000Z", "deterministic"),
    ]);

    expect(selected?.id).toBe("newer");
  });

  it("hides raw LLM fallback errors in public rationale copy", () => {
    expect(
      displayAgentRationale(
        "LLM planner fallback: LLM planner failed with HTTP 400.",
      ),
    ).toBe("deterministic planner (LLM unavailable)");
  });

  it("labels LLM traces with the recorded model", () => {
    expect(
      agentTraceLabel(
        query("llm", "2026-07-05T11:00:00.000Z", "llm", "gpt-test"),
      ),
    ).toBe("planned by gpt-test");
  });
});
