import { NextRequest, NextResponse } from "next/server";
import { agentServerModeFromEnv } from "@/lib/agent";
import { JUDGE_DEMO_QUESTION, JUDGE_DEMO_SOURCE_IDS } from "@/lib/judge-demo";

export const runtime = "nodejs";

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function atomicInteger(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) return null;
  return BigInt(value);
}

type CompletionFailure = {
  stage: string;
  check: string;
  error: string;
};

function completionFailure(
  body: Record<string, unknown>,
): CompletionFailure | null {
  const query = objectBody(body.query);
  const sourceDecisions = Array.isArray(query.sourceDecisions)
    ? query.sourceDecisions.map(objectBody)
    : [];
  const claimSupport = Array.isArray(query.claimSupport)
    ? query.claimSupport.map(objectBody)
    : [];
  const refundSummary = objectBody(query.refundSummary);
  const readerPayment = objectBody(query.readerPayment);
  const useIntent = objectBody(query.useIntent);
  const receipts = Array.isArray(body.receipts)
    ? body.receipts.map(objectBody)
    : [];
  const creatorBalances = Array.isArray(body.creatorBalances)
    ? body.creatorBalances.map(objectBody)
    : [];

  if (query.agentMode !== "llm") {
    return {
      stage: "agent-mode",
      check: "query.agentMode=llm",
      error: 'The paid result did not record query.agentMode as "llm".',
    };
  }
  if (query.agentServerMode !== "judge-strict") {
    return {
      stage: "agent-server-mode",
      check: "query.agentServerMode=judge-strict",
      error:
        'The paid result did not record query.agentServerMode as "judge-strict".',
    };
  }
  const decisionSourceIds = sourceDecisions.map(
    (decision) => decision.sourceId,
  );
  if (
    decisionSourceIds.length !== JUDGE_DEMO_SOURCE_IDS.length ||
    new Set(decisionSourceIds).size !== JUDGE_DEMO_SOURCE_IDS.length ||
    JUDGE_DEMO_SOURCE_IDS.some(
      (sourceId) => !decisionSourceIds.includes(sourceId),
    )
  ) {
    return {
      stage: "source-decisions",
      check: "query.sourceDecisions matches the fixed five-source pool",
      error:
        "The paid result did not record decisions for exactly the fixed five judge-demo sources.",
    };
  }
  if (!sourceDecisions.some((decision) => decision.selected === true)) {
    return {
      stage: "source-decisions",
      check: "query.sourceDecisions includes a buy",
      error: "The paid result did not include a source buy decision.",
    };
  }
  if (!sourceDecisions.some((decision) => decision.selected === false)) {
    return {
      stage: "source-decisions",
      check: "query.sourceDecisions includes a skip",
      error: "The paid result did not include a source skip decision.",
    };
  }
  if (
    !claimSupport.some(
      (support) =>
        support.status === "supported" &&
        nonEmptyString(support.sourceId) &&
        JUDGE_DEMO_SOURCE_IDS.includes(support.sourceId) &&
        nonEmptyString(support.span),
    )
  ) {
    return {
      stage: "claim-verification",
      check: "query.claimSupport includes a supported literal span",
      error:
        "The paid result did not include a supported claim with a literal span from the fixed source pool.",
    };
  }
  if (
    typeof refundSummary.refundedCount !== "number" ||
    refundSummary.refundedCount < 1
  ) {
    return {
      stage: "source-refund",
      check: "query.refundSummary.refundedCount>=1",
      error: "The paid result did not record an unused-source refund.",
    };
  }
  if (readerPayment.settlementMode !== "x402-settled") {
    return {
      stage: "reader-payment",
      check: "query.readerPayment.settlementMode=x402-settled",
      error:
        "The paid result did not record the sponsored reader payment as an exact x402 settlement.",
    };
  }
  if (!nonEmptyString(readerPayment.transaction)) {
    return {
      stage: "reader-payment",
      check: "query.readerPayment.transaction",
      error: "The paid result did not include the reader-payment transaction.",
    };
  }
  if (readerPayment.actorClass !== "operator") {
    return {
      stage: "configuration",
      check: "query.readerPayment.actorClass=operator",
      error:
        "The paid result was not classified as operator activity. Verify CIRCLE_PAYER_ADDRESS matches the sponsored payer.",
    };
  }
  if (!nonEmptyString(useIntent.digest)) {
    return {
      stage: "use-intent-signing",
      check: "query.useIntent.digest",
      error: "The paid result did not include a signed use-intent digest.",
    };
  }
  if (!nonEmptyString(useIntent.anchorTx)) {
    return {
      stage: "use-intent-anchoring",
      check: "query.useIntent.anchorTx",
      error: "The paid result did not include a use-intent anchor transaction.",
    };
  }
  const routedSourceIds = new Set(
    receipts
      .filter((receipt) => nonEmptyString(receipt.feeRouterPayTx))
      .map((receipt) => receipt.sourceId),
  );
  if (routedSourceIds.size === 0) {
    return {
      stage: "fee-router-settlement",
      check: "receipts includes feeRouterPayTx",
      error: "The paid result did not include a FeeRouter payout transaction.",
    };
  }
  const balanceSourceIds = creatorBalances.map((balance) => balance.sourceId);
  const balancesMatchCandidatePool =
    balanceSourceIds.length === JUDGE_DEMO_SOURCE_IDS.length &&
    new Set(balanceSourceIds).size === JUDGE_DEMO_SOURCE_IDS.length &&
    JUDGE_DEMO_SOURCE_IDS.every((sourceId) =>
      balanceSourceIds.includes(sourceId),
    );
  const hasVerifiedPositiveDelta = creatorBalances.some((balance) => {
    const before = atomicInteger(balance.beforeAtomicUsdc);
    const after = atomicInteger(balance.afterAtomicUsdc);
    const delta = atomicInteger(balance.deltaAtomicUsdc);
    return (
      before !== null &&
      before >= 0n &&
      after !== null &&
      after >= 0n &&
      delta !== null &&
      after - before === delta &&
      delta > 0n &&
      routedSourceIds.has(balance.sourceId)
    );
  });
  if (!balancesMatchCandidatePool || !hasVerifiedPositiveDelta) {
    return {
      stage: "creator-balance",
      check:
        "creatorBalances matches the fixed pool and includes a routed positive delta",
      error:
        "The paid result did not prove an internally consistent positive creator FeeRouter balance change.",
    };
  }
  return null;
}

function configurationError(message: string) {
  return NextResponse.json(
    {
      judgeDemo: true,
      stage: "configuration",
      error: message,
      question: JUDGE_DEMO_QUESTION,
    },
    { status: 503 },
  );
}

export async function POST(request: NextRequest) {
  try {
    if (agentServerModeFromEnv() !== "judge-strict") {
      return configurationError(
        "Judge demonstration requires LEPTONWEB_AGENT_MODE=judge-strict.",
      );
    }
  } catch (error) {
    return configurationError(
      error instanceof Error ? error.message : "Invalid judge configuration.",
    );
  }
  if (process.env.LEPTONWEB_FEE_ROUTER_ENABLED !== "1") {
    return configurationError(
      "Judge demonstration requires FeeRouter settlement to be enabled.",
    );
  }
  if (process.env.LEPTONWEB_USE_INTENT_ENABLED !== "1") {
    return configurationError(
      "Judge demonstration requires EIP-712 use-intent anchoring to be enabled.",
    );
  }
  if (!process.env.LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS) {
    return configurationError(
      "Judge demonstration requires a deployed UseReceiptRegistry address.",
    );
  }

  let response: Response;
  try {
    // Behind the reverse proxy the request origin is not reachable from the
    // server process itself; LEPTONWEB_INTERNAL_ORIGIN points at loopback.
    const target = new URL(
      "/api/paid-query/demo",
      process.env.LEPTONWEB_INTERNAL_ORIGIN ?? request.nextUrl.origin,
    );
    const forwardedIp = request.headers.get("x-real-ip");
    response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(forwardedIp ? { "x-real-ip": forwardedIp } : {}),
      },
      body: JSON.stringify({ question: JUDGE_DEMO_QUESTION }),
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        judgeDemo: true,
        stage: "sponsorship",
        error:
          error instanceof Error
            ? error.message
            : "The sponsored paid-query route could not be reached.",
        question: JUDGE_DEMO_QUESTION,
      },
      { status: 502 },
    );
  }
  const body = objectBody(await response.json().catch(() => null));
  const incomplete = response.ok ? completionFailure(body) : null;
  return NextResponse.json(
    {
      ...body,
      judgeDemo: true,
      question: JUDGE_DEMO_QUESTION,
      ...(!response.ok && typeof body.error !== "string"
        ? {
            error: `The sponsored paid-query route returned HTTP ${response.status} without structured error evidence.`,
          }
        : {}),
      ...(response.ok && !incomplete
        ? { stage: "complete" }
        : incomplete
          ? incomplete
          : {
              stage:
                typeof body.stage === "string" && body.stage
                  ? body.stage
                  : "sponsorship",
            }),
    },
    { status: incomplete ? 502 : response.status },
  );
}
