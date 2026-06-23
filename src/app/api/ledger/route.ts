import { NextResponse } from "next/server";
import {
  readLedger,
  summarizeCreators,
  verifyLedgerIntegrity,
} from "@/lib/ledger";

export const runtime = "nodejs";

export async function GET() {
  const ledger = await readLedger();
  return NextResponse.json({
    ledger,
    creators: summarizeCreators(ledger),
    verification: verifyLedgerIntegrity(ledger),
  });
}
