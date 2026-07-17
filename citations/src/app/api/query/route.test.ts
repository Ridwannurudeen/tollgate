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
    expect(mocks.settleQuestion).toHaveBeenCalledWith(
      "What is the best chocolate chip cookie recipe?",
      { settlePayments: false },
    );
  });

  it("projects historical private data without rewriting query or receipt hashes", async () => {
    const result = {
      query: {
        id: "historical-query",
        question: "Ask history@example.com",
        answer: "Answer from history@example.com",
        queryHash: `0x${"1".repeat(64)}`,
        answerHash: `0x${"2".repeat(64)}`,
        totalAtomicUsdc: 1_500,
        citations: [
          {
            sourceId: "source-1",
            title: "history@example.com",
            creator: "history@example.com",
            handle: "@history",
            wallet: "0x7777777777777777777777777777777777777777",
            url: "http://192.168.1.4/source",
            amountAtomicUsdc: 1_500,
            reason: "Requested by history@example.com",
          },
        ],
        receiptHashes: [`0x${"3".repeat(64)}`],
        trackRecord: {
          evidenceUri: "http://127.0.0.1:4318/private",
        },
        createdAt: "2026-07-05T00:00:00.000Z",
      },
      receipts: [
        {
          queryId: "historical-query",
          creator: "history@example.com",
          receiptHash: `0x${"3".repeat(64)}`,
          paymentResource: "http://10.0.0.9/private",
        },
      ],
      ledger: {
        queries: [],
        receipts: [],
      },
    };
    mocks.settleQuestion.mockResolvedValueOnce(result);

    const response = await POST(request("Ask history@example.com"));
    const body = (await response.json()) as {
      query: Record<string, unknown>;
      receipts: Array<Record<string, unknown>>;
    };
    const payload = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(payload).not.toContain("history@example.com");
    expect(payload).not.toContain("192.168.1.4");
    expect(payload).not.toContain("127.0.0.1");
    expect(payload).not.toContain("10.0.0.9");
    expect(body.query.queryHash).toBe(`0x${"1".repeat(64)}`);
    expect(body.query.answerHash).toBe(`0x${"2".repeat(64)}`);
    expect(body.receipts[0].receiptHash).toBe(`0x${"3".repeat(64)}`);
    expect(result.query.question).toBe("Ask history@example.com");
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
