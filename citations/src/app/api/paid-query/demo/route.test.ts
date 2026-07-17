import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JUDGE_DEMO_QUESTION, JUDGE_DEMO_SOURCE_IDS } from "@/lib/judge-demo";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  createFeeRouterPublicClient: vi.fn(),
  createW3SPaidFetch: vi.fn(),
  payerAddress: vi.fn(),
  payerWalletId: vi.fn(),
  readFeeRouterClaimable: vi.fn(),
  releaseDemoPaidQuery: vi.fn(),
  reserveDemoPaidQuery: vi.fn(),
  validateQuestion: vi.fn(),
}));

vi.mock("@/lib/circle-w3s", () => ({
  payerAddress: mocks.payerAddress,
  payerWalletId: mocks.payerWalletId,
}));

vi.mock("@/lib/fee-router", () => ({
  createFeeRouterPublicClient: mocks.createFeeRouterPublicClient,
  readFeeRouterClaimable: mocks.readFeeRouterClaimable,
  usdcRouterAbi: [],
}));

vi.mock("@/lib/rate-limit", () => ({
  reserveDemoPaidQuery: mocks.reserveDemoPaidQuery,
}));

vi.mock("@/lib/settlement", () => ({
  validateQuestion: mocks.validateQuestion,
}));

vi.mock("@/lib/x402-custodial", () => ({
  createW3SPaidFetch: mocks.createW3SPaidFetch,
}));

const PAYER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const previousInternalOrigin = process.env.LEPTONWEB_INTERNAL_ORIGIN;

function request() {
  return new NextRequest("http://tollgate.test/api/paid-query/demo", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "198.51.100.44",
    },
    body: JSON.stringify({ question: JUDGE_DEMO_QUESTION }),
  });
}

function settlementResult() {
  return {
    query: { id: "judge-query", question: JUDGE_DEMO_QUESTION },
    receipts: [{ sourceId: JUDGE_DEMO_SOURCE_IDS[0] }],
    ledger: { queries: [], receipts: [] },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.LEPTONWEB_INTERNAL_ORIGIN = "http://127.0.0.1:3091";
  mocks.payerWalletId.mockReturnValue("wallet-id");
  mocks.payerAddress.mockReturnValue(PAYER);
  mocks.validateQuestion.mockImplementation((question: string) =>
    question.trim(),
  );
  mocks.reserveDemoPaidQuery.mockReturnValue({
    release: mocks.releaseDemoPaidQuery,
  });
  mocks.createFeeRouterPublicClient.mockReturnValue({
    readContract: vi.fn().mockResolvedValue(100_000n),
  });
});

afterEach(() => {
  if (previousInternalOrigin === undefined) {
    delete process.env.LEPTONWEB_INTERNAL_ORIGIN;
  } else {
    process.env.LEPTONWEB_INTERNAL_ORIGIN = previousInternalOrigin;
  }
});

describe("POST /api/paid-query/demo", () => {
  it("returns before-and-after claimable balances for the fixed judge pool", async () => {
    const result = settlementResult();
    const paidFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    mocks.createW3SPaidFetch.mockReturnValue(paidFetch);
    mocks.readFeeRouterClaimable.mockImplementation(() => {
      const callIndex = mocks.readFeeRouterClaimable.mock.calls.length - 1;
      if (callIndex < JUDGE_DEMO_SOURCE_IDS.length)
        return Promise.resolve(1000n);
      return Promise.resolve(
        callIndex === JUDGE_DEMO_SOURCE_IDS.length ? 1200n : 1000n,
      );
    });

    const response = await POST(request());
    const body = (await response.json()) as {
      custodial: boolean;
      payer: string;
      creatorBalances: Array<{
        sourceId: string;
        beforeAtomicUsdc: string;
        afterAtomicUsdc: string;
        deltaAtomicUsdc: string;
      }>;
    };

    expect(response.status).toBe(201);
    expect(body.custodial).toBe(true);
    expect(body.payer).toBe(PAYER);
    expect(body.creatorBalances).toHaveLength(JUDGE_DEMO_SOURCE_IDS.length);
    expect(body.creatorBalances.map((balance) => balance.sourceId)).toEqual(
      JUDGE_DEMO_SOURCE_IDS,
    );
    expect(body.creatorBalances[0]).toMatchObject({
      beforeAtomicUsdc: "1000",
      afterAtomicUsdc: "1200",
      deltaAtomicUsdc: "200",
    });
    expect(mocks.readFeeRouterClaimable).toHaveBeenCalledTimes(10);
    expect(mocks.reserveDemoPaidQuery).toHaveBeenCalledWith("198.51.100.44");
    expect(paidFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3091/api/paid-query",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.releaseDemoPaidQuery).not.toHaveBeenCalled();
  });

  it("stops before payment when the initial creator balances cannot be read", async () => {
    mocks.readFeeRouterClaimable.mockRejectedValue(new Error("Arc RPC failed"));

    const response = await POST(request());
    const body = (await response.json()) as { stage: string; error: string };

    expect(response.status).toBe(503);
    expect(body.stage).toBe("creator-balance");
    expect(body.error).toBe("Arc RPC failed");
    expect(mocks.createW3SPaidFetch).not.toHaveBeenCalled();
    expect(mocks.reserveDemoPaidQuery).not.toHaveBeenCalled();
  });

  it("keeps settled evidence when the updated balance read fails", async () => {
    const result = settlementResult();
    mocks.createW3SPaidFetch.mockReturnValue(
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(result), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    mocks.readFeeRouterClaimable.mockImplementation(() => {
      if (
        mocks.readFeeRouterClaimable.mock.calls.length >
        JUDGE_DEMO_SOURCE_IDS.length
      ) {
        return Promise.reject(new Error("updated balance unavailable"));
      }
      return Promise.resolve(1000n);
    });

    const response = await POST(request());
    const body = (await response.json()) as {
      stage: string;
      error: string;
      query: { id: string };
      creatorBalancesBefore: unknown[];
    };

    expect(response.status).toBe(502);
    expect(body.stage).toBe("creator-balance");
    expect(body.error).toBe("updated balance unavailable");
    expect(body.query.id).toBe("judge-query");
    expect(body.creatorBalancesBefore).toHaveLength(
      JUDGE_DEMO_SOURCE_IDS.length,
    );
    expect(mocks.reserveDemoPaidQuery).toHaveBeenCalledOnce();
    expect(mocks.releaseDemoPaidQuery).not.toHaveBeenCalled();
  });

  it("releases a reservation when sponsorship cannot start", async () => {
    mocks.readFeeRouterClaimable.mockResolvedValue(1000n);
    mocks.createW3SPaidFetch.mockImplementation(() => {
      throw new Error("signer unavailable");
    });

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(mocks.reserveDemoPaidQuery).toHaveBeenCalledOnce();
    expect(mocks.releaseDemoPaidQuery).toHaveBeenCalledOnce();
  });
});
