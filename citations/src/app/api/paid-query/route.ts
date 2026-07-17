import { NextRequest, NextResponse } from "next/server";
import { PaidQueryAgentError } from "@/lib/settlement";
import {
  isSponsoredJudgePayment,
  JUDGE_DEMO_SOURCE_IDS,
} from "@/lib/judge-demo";
import {
  PAID_QUERY_PRICE_ATOMIC_USDC,
  tollgateAgentWallet,
} from "@/lib/payments";
import { projectPublicData, publicSettlementResult } from "@/lib/public-data";
import { leptonwebPublicOrigin } from "@/lib/public-origin";
import { settlePaidQuestion, validateQuestion } from "@/lib/settlement";
import {
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  buildExactPaymentRequirements,
  buildGatewayPaymentRequirements,
  paymentRequiredBody,
  paymentRequiredHeaders,
  settleX402,
} from "@/lib/x402-server";

export const runtime = "nodejs";

function readQuestion(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const question = (body as Record<string, unknown>).question;
  if (typeof question !== "string") {
    throw new Error("Question must be a string.");
  }
  return validateQuestion(question);
}

function readCreator(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const creator = (body as Record<string, unknown>).creator;
  return typeof creator === "string" && creator.trim()
    ? creator.trim()
    : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as unknown;
    const question = readQuestion(body);
    const creatorWallet = readCreator(body);
    const payTo = tollgateAgentWallet();
    // Multi-accept: exact first (browser injected-wallet clients), Gateway
    // second (autonomous agents using @circle-fin/x402-batching → batched
    // on-chain settlement). settleX402 picks whichever the payer signed.
    const accepts = [
      buildExactPaymentRequirements(payTo, PAID_QUERY_PRICE_ATOMIC_USDC),
      buildGatewayPaymentRequirements(payTo, PAID_QUERY_PRICE_ATOMIC_USDC),
    ];
    const resourceUrl = leptonwebPublicOrigin() + request.nextUrl.pathname;
    const required = paymentRequiredBody(
      accepts,
      resourceUrl,
      "Paid Tollgate answer: reader pays the agent, the answer allocates citation receipts to creators.",
    );
    const signatureHeader = request.headers.get(PAYMENT_SIGNATURE_HEADER);
    if (!signatureHeader) {
      return NextResponse.json(required, {
        status: 402,
        headers: paymentRequiredHeaders(required),
      });
    }

    const settlement = await settleX402(signatureHeader, accepts);
    if (!settlement.ok) {
      return NextResponse.json(
        { error: settlement.reason },
        { status: settlement.status },
      );
    }

    const judgeDemo = isSponsoredJudgePayment(question, settlement.payer);

    const result = await settlePaidQuestion(
      question,
      {
        amountAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
        settlementMode: settlement.mode,
        payTo: tollgateAgentWallet(),
        payer: settlement.payer,
        transaction: settlement.transaction,
        paymentResource: "/api/paid-query",
      },
      {
        creatorWallet,
        sourceIds: judgeDemo ? JUDGE_DEMO_SOURCE_IDS : undefined,
      },
    );

    return NextResponse.json(publicSettlementResult(result), {
      status: 201,
      headers: { [PAYMENT_RESPONSE_HEADER]: settlement.responseHeader },
    });
  } catch (error) {
    if (error instanceof PaidQueryAgentError) {
      return NextResponse.json(
        projectPublicData({
          error: error.message,
          stage: error.stage,
          readerPayment: error.readerPayment,
          query: error.query,
          priorFailure: error.priorFailure,
        }),
        { status: 502 },
      );
    }
    return NextResponse.json(
      projectPublicData({
        error:
          error instanceof Error
            ? error.message
            : "Paid query settlement failed.",
      }),
      { status: 400 },
    );
  }
}
