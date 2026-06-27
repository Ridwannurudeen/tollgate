import { NextRequest, NextResponse } from "next/server";
import type { Address } from "viem";
import { findSource } from "@/lib/catalog";
import { createSourceAccessRecord } from "@/lib/engine";
import { appendSettlement } from "@/lib/ledger";
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

type Context = {
  params: Promise<{ sourceId: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const { sourceId } = await context.params;
  const source = await findSource(sourceId);
  if (!source) {
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }

  const requirements = buildPaymentRequirements(
    source.wallet as Address,
    source.priceAtomicUsdc,
  );
  const resourceUrl =
    publicOrigin(request.headers, request.nextUrl.origin) +
    request.nextUrl.pathname;
  const required = paymentRequiredBody(
    requirements,
    resourceUrl,
    `Paid access to ${source.title} by ${source.creator}.`,
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
  const query = createSourceAccessRecord(source, new Date().toISOString());
  const ledgerResult = await appendSettlement(query, {
    [source.id]: {
      settlementMode: settlement.mode,
      payer: settlement.payer,
      transaction: settlement.transaction,
      paymentResource: `/api/sources/${source.id}`,
    },
  });

  return NextResponse.json(
    {
      source,
      settlementMode: settlement.mode,
      payer: settlement.payer,
      transaction: settlement.transaction ?? null,
      receipt: ledgerResult.receipts[0],
      ledger: ledgerResult.ledger,
    },
    { headers: { [PAYMENT_RESPONSE_HEADER]: settlement.responseHeader } },
  );
}
