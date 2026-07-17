import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  settlePaidQuestion: vi.fn(),
  settleX402: vi.fn(),
}));

vi.mock("@/lib/settlement", () => ({
  PaidQueryAgentError: class PaidQueryAgentError extends Error {},
  settlePaidQuestion: mocks.settlePaidQuestion,
  validateQuestion: (question: string) => question,
}));

vi.mock("@/lib/judge-demo", () => ({
  isSponsoredJudgePayment: () => false,
  JUDGE_DEMO_SOURCE_IDS: [],
}));

vi.mock("@/lib/payments", () => ({
  PAID_QUERY_PRICE_ATOMIC_USDC: 10_000,
  tollgateAgentWallet: () => "0x1111111111111111111111111111111111111111",
}));

vi.mock("@/lib/x402-server", () => ({
  PAYMENT_RESPONSE_HEADER: "PAYMENT-RESPONSE",
  PAYMENT_SIGNATURE_HEADER: "PAYMENT-SIGNATURE",
  buildExactPaymentRequirements: () => ({ scheme: "exact" }),
  buildGatewayPaymentRequirements: () => ({ scheme: "gateway" }),
  paymentRequiredBody: () => ({ x402Version: 2 }),
  paymentRequiredHeaders: () => ({}),
  publicOrigin: () => "https://tollgate.test",
  settleX402: mocks.settleX402,
}));

describe("POST /api/paid-query", () => {
  it("projects the public settlement result without rewriting hashes", async () => {
    const receiptHash = `0x${"3".repeat(64)}`;
    const result = {
      query: {
        id: "paid-query",
        question: "Ask history@example.com",
        answer: "Answer from history@example.com",
        queryHash: `0x${"1".repeat(64)}`,
        answerHash: `0x${"2".repeat(64)}`,
        totalAtomicUsdc: 10_000,
        citations: [],
        receiptHashes: [receiptHash],
        trackRecord: {
          evidenceUri: "http://127.0.0.1:4318/private",
        },
        createdAt: "2026-07-05T00:00:00.000Z",
      },
      receipts: [
        {
          creator: "history@example.com",
          receiptHash,
          paymentResource: "http://10.0.0.9/private",
        },
      ],
      ledger: { queries: [], receipts: [] },
    };
    mocks.settleX402.mockResolvedValueOnce({
      ok: true,
      mode: "x402-settled",
      payer: "0x2222222222222222222222222222222222222222",
      transaction: `0x${"4".repeat(64)}`,
      responseHeader: "settled",
    });
    mocks.settlePaidQuestion.mockResolvedValueOnce(result);
    const request = new NextRequest("https://tollgate.test/api/paid-query", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "PAYMENT-SIGNATURE": "signed-payment",
      },
      body: JSON.stringify({ question: "Ask history@example.com" }),
    });

    const response = await POST(request);
    const body = await response.json();
    const payload = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(payload).not.toContain("history@example.com");
    expect(payload).not.toContain("127.0.0.1");
    expect(payload).not.toContain("10.0.0.9");
    expect(body.query.queryHash).toBe(`0x${"1".repeat(64)}`);
    expect(body.query.answerHash).toBe(`0x${"2".repeat(64)}`);
    expect(body.receipts[0].receiptHash).toBe(receiptHash);
    expect(result.query.question).toBe("Ask history@example.com");
  });
});
