import { NextResponse } from "next/server";
import { readLedger } from "@/lib/ledger";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ hash: string }>;
};

export async function GET(_request: Request, context: Context) {
  const { hash } = await context.params;
  const ledger = await readLedger();
  const receipt = ledger.receipts.find(
    (candidate) => candidate.receiptHash === hash || candidate.id === hash,
  );
  if (!receipt) {
    return NextResponse.json({ error: "receipt not found" }, { status: 404 });
  }
  const query = ledger.queries.find(
    (candidate) => candidate.id === receipt.queryId,
  );
  return NextResponse.json({ receipt, query: query ?? null });
}
