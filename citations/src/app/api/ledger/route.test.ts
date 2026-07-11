import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  readLedger: vi.fn(),
  summarizeCreators: vi.fn(),
  verifyLedgerIntegrity: vi.fn(),
}));

vi.mock("@/lib/ledger", () => ({
  readLedger: mocks.readLedger,
  summarizeCreators: mocks.summarizeCreators,
  verifyLedgerIntegrity: mocks.verifyLedgerIntegrity,
}));

const ledger = {
  queries: [
    {
      id: "strict-paid",
      agentMode: "llm",
      readerPayment: { paymentHash: "paid" },
    },
    {
      id: "preview-free",
      agentMode: "deterministic",
    },
  ],
  receipts: [
    { queryId: "strict-paid", receiptHash: "strict-receipt" },
    { queryId: "preview-free", receiptHash: "preview-receipt" },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readLedger.mockResolvedValue(ledger);
  mocks.summarizeCreators.mockReturnValue([]);
  mocks.verifyLedgerIntegrity.mockReturnValue({
    ok: true,
    receiptCount: 2,
    latestHash: "strict-receipt",
    issues: [],
  });
});

describe("GET /api/ledger", () => {
  it("filters queries and receipts by agent mode and settlement state", async () => {
    const response = await GET(
      new NextRequest(
        "http://tollgate.test/api/ledger?agentMode=llm&settled=true",
      ),
    );
    const body = (await response.json()) as {
      ledger: typeof ledger;
      filter: {
        agentMode: string;
        settled: boolean;
        queryCount: number;
        receiptCount: number;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ledger.queries.map((query) => query.id)).toEqual([
      "strict-paid",
    ]);
    expect(body.ledger.receipts.map((receipt) => receipt.queryId)).toEqual([
      "strict-paid",
    ]);
    expect(body.filter).toEqual({
      agentMode: "llm",
      settled: true,
      queryCount: 1,
      receiptCount: 1,
    });
  });

  it.each([
    ["agentMode=hybrid", "agentMode must be llm or deterministic."],
    ["settled=yes", "settled must be true or false."],
  ])("rejects invalid filter %s", async (query, expectedError) => {
    const response = await GET(
      new NextRequest(`http://tollgate.test/api/ledger?${query}`),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(expectedError);
  });
});
