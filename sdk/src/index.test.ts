import { describe, expect, it, vi } from "vitest";
import {
  TollgateFetch,
  TollgateReaderError,
  TollgateSettlementResult,
  createReader,
} from "./index";

const baseUrl = "http://127.0.0.1:3000";

function fixture(
  question: string,
  settlementMode: "local-proof" | "x402-verified",
): TollgateSettlementResult {
  const query: TollgateSettlementResult["query"] = {
    id: "query-1",
    question,
    answer: `Answer for ${question}`,
    queryHash: "0xquery",
    answerHash: "0xanswer",
    totalAtomicUsdc: 1_000,
    citations: [],
    receiptHashes: ["0xreceipt"],
    createdAt: "2026-07-03T00:00:00.000Z",
  };

  if (settlementMode === "x402-verified") {
    query.readerPayment = {
      amountAtomicUsdc: 10_000,
      settlementMode,
      payTo: "0x1111111111111111111111111111111111111111",
      payer: "0x2222222222222222222222222222222222222222",
      paymentResource: "/api/paid-query",
      paymentHash: "0xpaid",
    };
  }

  return {
    query,
    receipts: [
      {
        id: "receipt-1",
        queryId: "query-1",
        sourceId: "source-1",
        creator: "Tollgate Lab",
        wallet: "0x3333333333333333333333333333333333333333",
        amountAtomicUsdc: 1_000,
        settlementMode,
        previousHash: "0x0000",
        receiptHash: "0xreceipt",
        createdAt: "2026-07-03T00:00:01.000Z",
      },
    ],
    ledger: {
      queries: [],
      receipts: [],
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createReader", () => {
  it("asks the free local endpoint with global fetch by default", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const mockFetch: TollgateFetch = async (input, init) => {
      const call: { input: RequestInfo | URL; init?: RequestInit } = { input };
      if (init !== undefined) {
        call.init = init;
      }
      calls.push(call);
      return jsonResponse(fixture("How does Tollgate work?", "local-proof"), 201);
    };
    vi.stubGlobal("fetch", mockFetch);

    const tollgate = createReader({ baseUrl });
    const result = await tollgate.ask("How does Tollgate work?");

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(`${baseUrl}/api/query`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ question: "How does Tollgate work?" }),
    );
    expect(result.answer).toBe("Answer for How does Tollgate work?");
    expect(result.query.id).toBe("query-1");
    expect(result.receipts).toHaveLength(1);
    expect(result.proofUrls).toEqual({
      proof: `${baseUrl}/proof`,
      answer: `${baseUrl}/answers/query-1`,
      answerByHash: `${baseUrl}/answers/0xanswer`,
      receipts: [`${baseUrl}/receipts/0xreceipt`],
    });
  });

  it("uses paidFetch for the paid query endpoint", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const paidFetch: TollgateFetch = async (input, init) => {
      const call: { input: RequestInfo | URL; init?: RequestInit } = { input };
      if (init !== undefined) {
        call.init = init;
      }
      calls.push(call);
      return jsonResponse(
        fixture("How does paid Tollgate work?", "x402-verified"),
        201,
      );
    };

    const tollgate = createReader({ baseUrl, paidFetch });
    const result = await tollgate.ask("How does paid Tollgate work?");

    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.input)).toBe(`${baseUrl}/api/paid-query`);
    expect(result.query.readerPayment?.settlementMode).toBe("x402-verified");
    expect(result.proofUrls.receipts).toEqual([
      `${baseUrl}/receipts/0xreceipt`,
    ]);
  });

  it("throws a reader error with the response status and body", async () => {
    const mockFetch: TollgateFetch = async () =>
      jsonResponse({ error: "Question must be a string." }, 400);
    vi.stubGlobal("fetch", mockFetch);

    const tollgate = createReader({ baseUrl });

    await expect(tollgate.ask("")).rejects.toMatchObject({
      name: "TollgateReaderError",
      endpoint: `${baseUrl}/api/query`,
      status: 400,
      responseBody: { error: "Question must be a string." },
      message: "Question must be a string.",
    } satisfies Partial<TollgateReaderError>);
  });
});
