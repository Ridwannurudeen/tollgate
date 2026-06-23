import { NextResponse } from "next/server";
import { ARC_CAIP2, ARC_RPC_URL, ARC_USDC } from "@/lib/chain";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";
import {
  PAID_QUERY_PRICE_ATOMIC_USDC,
  tollgateAgentWallet,
} from "@/lib/payments";

export const runtime = "nodejs";

export async function GET() {
  const ledger = await readLedger();
  const verification = verifyLedgerIntegrity(ledger);
  const latestVerifiedReceipt = ledger.receipts
    .slice()
    .reverse()
    .find((receipt) => receipt.settlementMode === "x402-verified");
  const latestSettledReceipt = ledger.receipts
    .slice()
    .reverse()
    .find((receipt) => receipt.settlementMode === "x402-settled");
  const latestReaderPayment = ledger.queries.find(
    (query) => query.readerPayment,
  )?.readerPayment;
  const readerPaymentTotalAtomicUsdc = ledger.queries.reduce(
    (sum, query) => sum + (query.readerPayment?.amountAtomicUsdc ?? 0),
    0,
  );

  return NextResponse.json({
    mode: process.env.FACILITATOR_PRIVATE_KEY
      ? "settle-enabled"
      : "verify-only",
    facilitatorConfigured: Boolean(process.env.FACILITATOR_PRIVATE_KEY),
    network: ARC_CAIP2,
    asset: ARC_USDC,
    rpcConfigured: Boolean(ARC_RPC_URL),
    paidQueryPriceAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
    tollgateAgentWallet: tollgateAgentWallet(),
    latestReaderPayment: latestReaderPayment ?? null,
    readerPaymentTotalAtomicUsdc,
    latestVerifiedReceipt: latestVerifiedReceipt?.receiptHash ?? null,
    latestSettledReceipt: latestSettledReceipt?.receiptHash ?? null,
    verification,
  });
}
