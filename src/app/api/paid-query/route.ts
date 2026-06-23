import { NextRequest, NextResponse } from "next/server";
import {
  PAID_QUERY_PRICE_ATOMIC_USDC,
  tollgateAgentWallet,
} from "@/lib/payments";
import { settlePaidQuestion, validateQuestion } from "@/lib/settlement";
import {
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  buildPaymentRequirements,
  paymentRequiredBody,
  paymentRequiredHeaders,
  publicOrigin,
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

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as unknown;
    const question = readQuestion(body);
    const requirements = buildPaymentRequirements(
      tollgateAgentWallet(),
      PAID_QUERY_PRICE_ATOMIC_USDC,
    );
    const resourceUrl =
      publicOrigin(request.headers, request.nextUrl.origin) +
      request.nextUrl.pathname;
    const required = paymentRequiredBody(
      requirements,
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

    const settlement = await settleX402(signatureHeader, requirements);
    if (!settlement.ok) {
      return NextResponse.json(
        { error: settlement.reason },
        { status: settlement.status },
      );
    }

    const result = await settlePaidQuestion(question, {
      amountAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
      settlementMode: settlement.mode,
      payTo: tollgateAgentWallet(),
      payer: settlement.payer,
      transaction: settlement.transaction,
      paymentResource: "/api/paid-query",
    });

    return NextResponse.json(
      {
        ...result,
        readerPayment: result.query.readerPayment,
      },
      {
        status: 201,
        headers: { [PAYMENT_RESPONSE_HEADER]: settlement.responseHeader },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Paid query settlement failed.",
      },
      { status: 400 },
    );
  }
}
