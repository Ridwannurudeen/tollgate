import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  appendSettlement: vi.fn(),
  createSourceAccessRecord: vi.fn(),
  findSource: vi.fn(),
  paymentRequiredBody: vi.fn(),
  settleX402: vi.fn(),
}));

vi.mock("@/lib/catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/catalog")>();
  return {
    findSource: mocks.findSource,
    publicSource: actual.publicSource,
  };
});

vi.mock("@/lib/engine", () => ({
  createSourceAccessRecord: mocks.createSourceAccessRecord,
}));

vi.mock("@/lib/escrow", () => ({
  shouldEscrowSource: () => false,
}));

vi.mock("@/lib/ledger", () => ({
  appendSettlement: mocks.appendSettlement,
}));

vi.mock("@/lib/payments", () => ({
  tollgateAgentWallet: () => "0x1111111111111111111111111111111111111111",
}));

vi.mock("@/lib/public-origin", () => ({
  leptonwebPublicOrigin: () => "https://tollgate.test",
}));

vi.mock("@/lib/x402-server", () => ({
  PAYMENT_RESPONSE_HEADER: "PAYMENT-RESPONSE",
  PAYMENT_SIGNATURE_HEADER: "PAYMENT-SIGNATURE",
  buildPaymentRequirements: () => ({ amount: "1500" }),
  paymentRequiredBody: mocks.paymentRequiredBody,
  paymentRequiredHeaders: () => ({}),
  settleX402: mocks.settleX402,
}));

const source = {
  id: "source-1",
  title: "Source One",
  creator: "Source Lab",
  handle: "@source",
  wallet: "0x7777777777777777777777777777777777777777",
  url: "https://example.com/source",
  summary: "Source summary.",
  tags: ["source"],
  priceAtomicUsdc: 1500,
  sourceKind: "external",
  creatorKind: "external",
  verifiedCreator: true,
  custody: "circle-w3s",
  walletId: "private-circle-wallet-id",
  notifyEmail: "private@example.com",
};

describe("GET /api/sources/[sourceId]", () => {
  beforeEach(() => {
    mocks.appendSettlement.mockReset();
    mocks.createSourceAccessRecord.mockReset();
    mocks.findSource.mockReset();
    mocks.paymentRequiredBody.mockReset();
    mocks.settleX402.mockReset();
    mocks.findSource.mockResolvedValue(source);
    mocks.createSourceAccessRecord.mockReturnValue({
      id: "query-1",
      citations: [],
    });
    mocks.paymentRequiredBody.mockImplementation(
      (_requirements, _resourceUrl, description) => ({
        x402Version: 2,
        description,
      }),
    );
    mocks.settleX402.mockResolvedValue({
      ok: true,
      mode: "x402-settled",
      payer: "0x2222222222222222222222222222222222222222",
      transaction: `0x${"ab".repeat(32)}`,
      responseHeader: "settled",
    });
    mocks.appendSettlement.mockResolvedValue({
      receipts: [{ id: "receipt-1" }],
      ledger: { queries: [], receipts: [] },
    });
  });

  it("omits private custody metadata after payment", async () => {
    const request = new NextRequest(
      "https://tollgate.test/api/sources/source-1",
      { headers: { "PAYMENT-SIGNATURE": "signed-payment" } },
    );
    const response = await GET(request, {
      params: Promise.resolve({ sourceId: "source-1" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.source.walletId).toBeUndefined();
    expect(body.source.notifyEmail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("private-circle-wallet-id");
    expect(JSON.stringify(body)).not.toContain("private@example.com");
  });

  it("projects the returned receipt and ledger without rewriting hashes", async () => {
    const receiptHash = `0x${"3".repeat(64)}`;
    mocks.appendSettlement.mockResolvedValueOnce({
      receipts: [
        {
          id: "receipt-1",
          creator: "history@example.com",
          receiptHash,
          paymentResource: "http://127.0.0.1:3000/private",
        },
      ],
      ledger: {
        queries: [
          {
            id: "query-1",
            question: "Paid source access for history@example.com",
            queryHash: `0x${"1".repeat(64)}`,
            answerHash: `0x${"2".repeat(64)}`,
          },
        ],
        receipts: [],
      },
    });
    const request = new NextRequest(
      "https://tollgate.test/api/sources/source-1",
      { headers: { "PAYMENT-SIGNATURE": "signed-payment" } },
    );

    const response = await GET(request, {
      params: Promise.resolve({ sourceId: "source-1" }),
    });
    const body = await response.json();
    const payload = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(payload).not.toContain("history@example.com");
    expect(payload).not.toContain("127.0.0.1");
    expect(body.receipt.receiptHash).toBe(receiptHash);
    expect(body.ledger.queries[0].queryHash).toBe(`0x${"1".repeat(64)}`);
    expect(body.ledger.queries[0].answerHash).toBe(`0x${"2".repeat(64)}`);
  });

  it("redacts public source text in the unpaid payment description", async () => {
    mocks.findSource.mockResolvedValueOnce({
      ...source,
      title: "Contact paywall@example.com",
      creator: "paywall@example.com",
    });
    const request = new NextRequest(
      "https://tollgate.test/api/sources/source-1",
    );

    const response = await GET(request, {
      params: Promise.resolve({ sourceId: "source-1" }),
    });
    const payload = JSON.stringify(await response.json());

    expect(response.status).toBe(402);
    expect(payload).not.toContain("paywall@example.com");
  });
});
