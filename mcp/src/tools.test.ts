import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPaidFetch,
  tollgateAsk,
  tollgateSources,
  type FetchLike,
} from "./tools.js";

const PROD_BASE_URL = "https://tollgate.gudman.xyz";

function paidFixture(question: string) {
  return {
    query: {
      id: "query-1",
      question,
      answer: `Answer for ${question}`,
      queryHash: "0xquery",
      answerHash: "0xanswer",
      totalAtomicUsdc: 1000,
      citations: [],
      receiptHashes: ["0xreceipt"],
      readerPayment: {
        amountAtomicUsdc: 10000,
        settlementMode: "x402-verified",
        payTo: "0x1111111111111111111111111111111111111111",
        payer: "0x2222222222222222222222222222222222222222",
        paymentResource: "/api/paid-query",
        paymentHash: "0xpaid",
      },
      createdAt: "2026-07-03T00:00:00.000Z",
    },
    receipts: [
      {
        id: "receipt-1",
        queryId: "query-1",
        sourceId: "source-1",
        creator: "Creator",
        wallet: "0x3333333333333333333333333333333333333333",
        amountAtomicUsdc: 1000,
        settlementMode: "x402-verified",
        previousHash: "0xprevious",
        receiptHash: "0xreceipt",
        createdAt: "2026-07-03T00:00:01.000Z",
      },
    ],
  };
}

describe("tollgate MCP tools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the live Tollgate base URL by default for source reads", async () => {
    const fetcher = vi.fn<FetchLike>(async () =>
      new Response(JSON.stringify({ sources: [] }), { status: 200 }),
    );

    await tollgateSources(fetcher);

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(`${PROD_BASE_URL}/api/sources`);
  });

  it("summarizes the free source registry", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sources: [
            {
              id: "source-1",
              title: "Source One",
              creator: "Creator",
              wallet: "0x1111111111111111111111111111111111111111",
              priceAtomicUsdc: 1500,
              verifiedCreator: true,
              probation: false,
              url: "https://example.com/source",
              notifyEmail: "private@example.com",
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(tollgateSources(fetcher)).resolves.toEqual([
      {
        id: "source-1",
        title: "Source One",
        creator: "Creator",
        wallet: "0x1111111111111111111111111111111111111111",
        priceAtomicUsdc: 1500,
        verifiedCreator: true,
        probation: false,
        url: "https://example.com/source",
      },
    ]);
  });

  it("rejects malformed registry responses", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(tollgateSources(fetcher)).rejects.toThrow("missing sources");
  });

  it("requires a reader key for tollgate_ask by default", async () => {
    await expect(
      tollgateAsk("How does Tollgate prove paid answers?", { env: {} }),
    ).rejects.toThrow("TOLLGATE_READER_PRIVATE_KEY");
  });

  it("reads process env when no env object is injected", async () => {
    vi.stubEnv("TOLLGATE_ALLOW_FREE_QUERY", "1");
    const fetcher = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify(paidFixture("How does Tollgate prove paid answers?")),
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetcher);

    await tollgateAsk("How does Tollgate prove paid answers?");

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      `${PROD_BASE_URL}/api/query`,
    );
  });

  it("uses paidFetch for the paid query endpoint", async () => {
    const paidFetch = vi.fn<FetchLike>(async () =>
      new Response(
        JSON.stringify(paidFixture("How does Tollgate prove paid answers?")),
        { status: 201 },
      ),
    );

    const result = await tollgateAsk("How does Tollgate prove paid answers?", {
      paidFetch,
    });

    expect(String(paidFetch.mock.calls[0]?.[0])).toBe(
      `${PROD_BASE_URL}/api/paid-query`,
    );
    expect(result.query.readerPayment?.settlementMode).toBe("x402-verified");
    expect(result.proofUrls.answer).toBe(`${PROD_BASE_URL}/answers/query-1`);
  });

  it("rejects malformed reader private keys before spending", () => {
    expect(() => createPaidFetch("not-a-key")).toThrow(
      "TOLLGATE_READER_PRIVATE_KEY",
    );
  });
});
