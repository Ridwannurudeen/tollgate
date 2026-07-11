import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JUDGE_DEMO_QUESTION, JUDGE_DEMO_SOURCE_IDS } from "@/lib/judge-demo";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  agentServerModeFromEnv: vi.fn(),
}));

vi.mock("@/lib/agent", () => ({
  agentServerModeFromEnv: mocks.agentServerModeFromEnv,
}));

const ENV_NAMES = [
  "LEPTONWEB_FEE_ROUTER_ENABLED",
  "LEPTONWEB_USE_INTENT_ENABLED",
  "LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS",
];

type CompleteResult = {
  query: {
    id: string;
    agentMode: string;
    agentServerMode: string;
    sourceDecisions: Array<{ sourceId: string; selected: boolean }>;
    claimSupport: Array<{
      claim: string;
      sourceId: string | null;
      span: string | null;
      status: string;
    }>;
    refundSummary: { refundedCount: number };
    readerPayment: {
      transaction?: string;
      actorClass: string;
      settlementMode: string;
    };
    useIntent: { digest?: string; anchorTx?: string };
  };
  receipts: Array<{ sourceId: string; feeRouterPayTx?: string }>;
  creatorBalances: Array<{
    sourceId: string;
    beforeAtomicUsdc: string;
    afterAtomicUsdc: string;
    deltaAtomicUsdc: string;
  }>;
  ledger: { marker: string };
};

function completeResult(): CompleteResult {
  return {
    query: {
      id: "judge-query",
      agentMode: "llm",
      agentServerMode: "judge-strict",
      sourceDecisions: JUDGE_DEMO_SOURCE_IDS.map((sourceId, index) => ({
        sourceId,
        selected: index < 2,
      })),
      claimSupport: [
        {
          claim: "A supported claim.",
          sourceId: JUDGE_DEMO_SOURCE_IDS[0],
          span: "literal source evidence",
          status: "supported",
        },
      ],
      refundSummary: { refundedCount: 1 },
      readerPayment: {
        transaction: `0x${"4".repeat(64)}`,
        actorClass: "operator",
        settlementMode: "x402-settled",
      },
      useIntent: {
        digest: `0x${"5".repeat(64)}`,
        anchorTx: `0x${"6".repeat(64)}`,
      },
    },
    receipts: [
      {
        sourceId: JUDGE_DEMO_SOURCE_IDS[0],
        feeRouterPayTx: `0x${"7".repeat(64)}`,
      },
    ],
    creatorBalances: JUDGE_DEMO_SOURCE_IDS.map((sourceId, index) => ({
      sourceId,
      beforeAtomicUsdc: "1000",
      afterAtomicUsdc: index === 0 ? "1200" : "1000",
      deltaAtomicUsdc: index === 0 ? "200" : "0",
    })),
    ledger: { marker: "settled-ledger" },
  };
}

function request(): NextRequest {
  return new NextRequest("http://tollgate.test/api/judge-demo", {
    method: "POST",
    headers: { "x-real-ip": "198.51.100.77" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const name of ENV_NAMES) delete process.env[name];
});

function configureJudgeDemo() {
  mocks.agentServerModeFromEnv.mockReturnValue("judge-strict");
  process.env.LEPTONWEB_FEE_ROUTER_ENABLED = "1";
  process.env.LEPTONWEB_USE_INTENT_ENABLED = "1";
  process.env.LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS =
    "0x1111111111111111111111111111111111111111";
}

describe("POST /api/judge-demo", () => {
  it("fails at configuration instead of silently running a non-strict planner", async () => {
    mocks.agentServerModeFromEnv.mockReturnValue("production");
    const response = await POST(request());
    const body = (await response.json()) as {
      stage: string;
      error: string;
    };

    expect(response.status).toBe(503);
    expect(body.stage).toBe("configuration");
    expect(body.error).toContain("judge-strict");
  });

  it("proxies the fixed question to the sponsored paid route", async () => {
    configureJudgeDemo();
    const result = completeResult();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(result), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request());
    const body = (await response.json()) as {
      judgeDemo: boolean;
      stage: string;
      question: string;
    };
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;

    expect(response.status).toBe(201);
    expect(body.judgeDemo).toBe(true);
    expect(body.stage).toBe("complete");
    expect(body.question).toBe(JUDGE_DEMO_QUESTION);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      question: JUDGE_DEMO_QUESTION,
    });
    expect(body).toMatchObject(result);
  });

  it.each<[string, string, string, (result: CompleteResult) => void]>([
    [
      "non-LLM result",
      "agent-mode",
      "query.agentMode=llm",
      (result) => {
        result.query.agentMode = "deterministic";
      },
    ],
    [
      "non-strict result",
      "agent-server-mode",
      "query.agentServerMode=judge-strict",
      (result) => {
        result.query.agentServerMode = "production";
      },
    ],
    [
      "wrong candidate pool",
      "source-decisions",
      "query.sourceDecisions matches the fixed five-source pool",
      (result) => {
        result.query.sourceDecisions.pop();
      },
    ],
    [
      "missing buy",
      "source-decisions",
      "query.sourceDecisions includes a buy",
      (result) => {
        result.query.sourceDecisions.forEach((decision) => {
          decision.selected = false;
        });
      },
    ],
    [
      "missing skip",
      "source-decisions",
      "query.sourceDecisions includes a skip",
      (result) => {
        result.query.sourceDecisions.forEach((decision) => {
          decision.selected = true;
        });
      },
    ],
    [
      "missing claim support",
      "claim-verification",
      "query.claimSupport includes a supported literal span",
      (result) => {
        result.query.claimSupport = [];
      },
    ],
    [
      "missing unused-source refund",
      "source-refund",
      "query.refundSummary.refundedCount>=1",
      (result) => {
        result.query.refundSummary.refundedCount = 0;
      },
    ],
    [
      "non-exact reader settlement",
      "reader-payment",
      "query.readerPayment.settlementMode=x402-settled",
      (result) => {
        result.query.readerPayment.settlementMode = "gateway-batched";
      },
    ],
    [
      "missing reader transaction",
      "reader-payment",
      "query.readerPayment.transaction",
      (result) => {
        delete result.query.readerPayment.transaction;
      },
    ],
    [
      "non-operator reader payment",
      "configuration",
      "query.readerPayment.actorClass=operator",
      (result) => {
        result.query.readerPayment.actorClass = "unclassified";
      },
    ],
    [
      "missing intent digest",
      "use-intent-signing",
      "query.useIntent.digest",
      (result) => {
        delete result.query.useIntent.digest;
      },
    ],
    [
      "missing intent anchor",
      "use-intent-anchoring",
      "query.useIntent.anchorTx",
      (result) => {
        delete result.query.useIntent.anchorTx;
      },
    ],
    [
      "missing FeeRouter payout",
      "fee-router-settlement",
      "receipts includes feeRouterPayTx",
      (result) => {
        delete result.receipts[0].feeRouterPayTx;
      },
    ],
    [
      "missing creator balance change",
      "creator-balance",
      "creatorBalances matches the fixed pool and includes a routed positive delta",
      (result) => {
        result.creatorBalances[0].afterAtomicUsdc = "1000";
        result.creatorBalances[0].deltaAtomicUsdc = "0";
      },
    ],
  ])(
    "returns the settled evidence as a partial failure for %s",
    async (_name, expectedStage, expectedCheck, mutate) => {
      configureJudgeDemo();
      const result = completeResult();
      mutate(result);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(result), {
            status: 201,
            headers: { "content-type": "application/json" },
          }),
        ),
      );

      const response = await POST(request());
      const body = (await response.json()) as {
        stage: string;
        check: string;
        error: string;
        query: unknown;
        receipts: unknown;
        ledger: unknown;
      };

      expect(response.status).toBe(502);
      expect(body.stage).toBe(expectedStage);
      expect(body.check).toBe(expectedCheck);
      expect(body.error).toBeTruthy();
      expect(body.query).toEqual(result.query);
      expect(body.receipts).toEqual(result.receipts);
      expect(body.ledger).toEqual(result.ledger);
    },
  );

  it("preserves the exact downstream stage and partial payment evidence", async () => {
    configureJudgeDemo();
    const readerPayment = {
      amountAtomicUsdc: 10_000,
      settlementMode: "x402-settled",
      payTo: "0x2222222222222222222222222222222222222222",
      paymentResource: "/api/paid-query",
      paymentHash: `0x${"3".repeat(64)}`,
      transaction: `0x${"4".repeat(64)}`,
      refund: {
        amountAtomicUsdc: 10_000,
        transaction: `0x${"5".repeat(64)}`,
        reason: "judge-strict-planner-failure",
      },
    };
    const partialQuery = {
      id: "partial-query",
      question: JUDGE_DEMO_QUESTION,
      agentModel: "verified-model",
    };
    const priorFailure = {
      stage: "claim-verification",
      message: "The verifier timed out before the reader refund failed.",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Judge-strict mode failed during draft: upstream timeout",
            stage: "draft",
            readerPayment,
            query: partialQuery,
            priorFailure,
          }),
          {
            status: 502,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    );

    const response = await POST(request());
    const body = (await response.json()) as {
      stage: string;
      readerPayment: unknown;
      query: unknown;
      priorFailure: unknown;
    };

    expect(response.status).toBe(502);
    expect(body.stage).toBe("draft");
    expect(body.readerPayment).toEqual(readerPayment);
    expect(body.query).toEqual(partialQuery);
    expect(body.priorFailure).toEqual(priorFailure);
  });

  it("reports a sponsored-route transport failure without claiming success", async () => {
    configureJudgeDemo();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("custodial route unavailable")),
    );

    const response = await POST(request());
    const body = (await response.json()) as {
      judgeDemo: boolean;
      stage: string;
      error: string;
    };

    expect(response.status).toBe(502);
    expect(body.judgeDemo).toBe(true);
    expect(body.stage).toBe("sponsorship");
    expect(body.error).toBe("custodial route unavailable");
  });
});
