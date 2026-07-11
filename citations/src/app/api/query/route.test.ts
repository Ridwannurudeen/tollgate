import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import type { SettlementResult } from "@/lib/types";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  settleQuestion: vi.fn(),
}));

vi.mock("@/lib/settlement", () => ({
  settleQuestion: mocks.settleQuestion,
}));

function request(question: string): NextRequest {
  return new NextRequest("http://tollgate.test/api/query", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.77",
    },
    body: JSON.stringify({ question }),
  });
}

describe("POST /api/query", () => {
  it("preserves a zero-citation cannot-answer result", async () => {
    const result: SettlementResult = {
      query: {
        id: "cannot-answer",
        question: "What is the best chocolate chip cookie recipe?",
        answer:
          "No registered source covers this question, so the agent did not buy a citation or fabricate an answer.",
        queryHash: "query-hash",
        answerHash: "answer-hash",
        totalAtomicUsdc: 0,
        citations: [],
        agentMode: "deterministic",
        receiptHashes: [],
        createdAt: "2026-07-05T00:00:00.000Z",
      },
      receipts: [],
      ledger: {
        queries: [],
        receipts: [],
      },
    };
    mocks.settleQuestion.mockResolvedValueOnce(result);

    const response = await POST(
      request("What is the best chocolate chip cookie recipe?"),
    );
    const body = (await response.json()) as SettlementResult;

    expect(response.status).toBe(201);
    expect(body.query.citations).toEqual([]);
    expect(body.query.totalAtomicUsdc).toBe(0);
    expect(body.query.receiptHashes).toEqual([]);
    expect(body.receipts).toEqual([]);
  });

  it("surfaces a missing judge-strict planner as a configuration stage", async () => {
    mocks.settleQuestion.mockRejectedValueOnce(
      new Error("Judge-strict mode requires a configured LLM planner."),
    );

    const response = await POST(
      request("How does a strict agent buy useful citations?"),
    );
    const body = (await response.json()) as { error: string; stage: string };

    expect(response.status).toBe(502);
    expect(body.stage).toBe("configuration");
    expect(body.error).toContain("configured LLM planner");
  });
});
