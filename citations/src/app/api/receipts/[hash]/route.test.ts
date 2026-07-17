import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  readLedger: vi.fn(),
}));

vi.mock("@/lib/ledger", () => ({
  readLedger: mocks.readLedger,
}));

describe("GET /api/receipts/[hash]", () => {
  it("redacts public text and private URLs without rewriting stored hashes", async () => {
    const receiptHash = `0x${"3".repeat(64)}`;
    const ledger = {
      queries: [
        {
          id: "historical-query",
          question: "Ask history@example.com",
          answer: "Answer from history@example.com",
          queryHash: `0x${"1".repeat(64)}`,
          answerHash: `0x${"2".repeat(64)}`,
          citations: [],
          receiptHashes: [receiptHash],
          trackRecord: {
            evidenceUri: "http://127.0.0.1:4318/private",
          },
        },
      ],
      receipts: [
        {
          id: "receipt-1",
          queryId: "historical-query",
          creator: "history@example.com",
          paymentResource: "http://10.0.0.9/private",
          previousHash: `0x${"0".repeat(64)}`,
          receiptHash,
        },
      ],
    };
    mocks.readLedger.mockResolvedValue(ledger);

    const response = await GET(new Request("http://tollgate.test"), {
      params: Promise.resolve({ hash: receiptHash }),
    });
    const body = (await response.json()) as {
      receipt: Record<string, unknown>;
      query: Record<string, unknown>;
    };
    const payload = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(payload).not.toContain("history@example.com");
    expect(payload).not.toContain("127.0.0.1");
    expect(payload).not.toContain("10.0.0.9");
    expect(body.receipt.receiptHash).toBe(receiptHash);
    expect(body.query.queryHash).toBe(`0x${"1".repeat(64)}`);
    expect(body.query.answerHash).toBe(`0x${"2".repeat(64)}`);
    expect(ledger.receipts[0].creator).toBe("history@example.com");
  });
});
