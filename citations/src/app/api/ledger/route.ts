import { NextRequest, NextResponse } from "next/server";
import {
  readLedger,
  summarizeCreators,
  verifyLedgerIntegrity,
} from "@/lib/ledger";
import { projectPublicData, publicLedger } from "@/lib/public-data";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ledger = await readLedger();
  const requestedAgentMode = request.nextUrl.searchParams.get("agentMode");
  const requestedSettled = request.nextUrl.searchParams.get("settled");
  if (
    requestedAgentMode !== null &&
    requestedAgentMode !== "llm" &&
    requestedAgentMode !== "deterministic"
  ) {
    return NextResponse.json(
      { error: "agentMode must be llm or deterministic." },
      { status: 400 },
    );
  }
  if (
    requestedSettled !== null &&
    requestedSettled !== "true" &&
    requestedSettled !== "false"
  ) {
    return NextResponse.json(
      { error: "settled must be true or false." },
      { status: 400 },
    );
  }

  const filtered = requestedAgentMode !== null || requestedSettled !== null;
  const filteredQueries = filtered
    ? ledger.queries.filter((query) => {
        const matchesAgentMode =
          requestedAgentMode === null || query.agentMode === requestedAgentMode;
        const matchesSettled =
          requestedSettled === null ||
          (requestedSettled === "true" && query.readerPayment !== undefined) ||
          (requestedSettled === "false" && query.readerPayment === undefined);
        return matchesAgentMode && matchesSettled;
      })
    : ledger.queries;
  const filteredQueryIds = new Set(filteredQueries.map((query) => query.id));
  const responseLedger = filtered
    ? {
        queries: filteredQueries,
        receipts: ledger.receipts.filter((receipt) =>
          filteredQueryIds.has(receipt.queryId),
        ),
      }
    : ledger;
  const sourceVerification = verifyLedgerIntegrity(ledger);
  return NextResponse.json({
    ledger: publicLedger(responseLedger),
    creators: projectPublicData(summarizeCreators(responseLedger)),
    verification: sourceVerification,
    ...(filtered
      ? {
          filter: {
            agentMode: requestedAgentMode,
            settled:
              requestedSettled === null ? null : requestedSettled === "true",
            queryCount: responseLedger.queries.length,
            receiptCount: responseLedger.receipts.length,
          },
        }
      : {}),
  });
}
