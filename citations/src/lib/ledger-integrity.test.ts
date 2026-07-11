import { describe, expect, it } from "vitest";
import { createQueryRecord } from "./engine";
import { sha256Hex } from "./hash";
import { createReceipts, verifyLedgerIntegrity } from "./ledger";
import type { Ledger, QueryRecord } from "./types";

function ledgerFor(query: QueryRecord): Ledger {
  const receipts = createReceipts(query, []);
  return {
    queries: [{ ...query, receiptHashes: receipts.map((receipt) => receipt.receiptHash) }],
    receipts,
  };
}

describe("ledger integrity", () => {
  it("rejects a tampered receipt amount", () => {
    const ledger = ledgerFor(
      createQueryRecord(
        "How should AI agents pay publishers per citation?",
        "2026-07-11T01:00:00.000Z",
      ),
    );
    const firstReceipt = ledger.receipts[0];
    if (!firstReceipt) throw new Error("missing test receipt");

    const verification = verifyLedgerIntegrity({
      ...ledger,
      receipts: [
        { ...firstReceipt, amountAtomicUsdc: firstReceipt.amountAtomicUsdc + 1 },
        ...ledger.receipts.slice(1),
      ],
    });

    expect(verification.ok).toBe(false);
    expect(verification.issues.some((issue) => issue.reason.includes("receiptHash"))).toBe(
      true,
    );
  });

  it("rejects a tampered source decision through the trace hash", () => {
    const query = createQueryRecord(
      "How should AI agents pay publishers per citation?",
      "2026-07-11T01:01:00.000Z",
    );
    const firstDecision = query.sourceDecisions?.[0];
    if (!firstDecision) throw new Error("missing source decision");

    const verification = verifyLedgerIntegrity({
      ...ledgerFor(query),
      queries: [
        {
          ...query,
          sourceDecisions: [
            { ...firstDecision, score: firstDecision.score + 1 },
            ...(query.sourceDecisions?.slice(1) ?? []),
          ],
        },
      ],
    });

    expect(verification.ok).toBe(false);
    expect(verification.issues.some((issue) => issue.reason.includes("trace"))).toBe(
      true,
    );
  });

  it("continues to accept legacy trace hashes", () => {
    const query = createQueryRecord(
      "How should AI agents pay publishers per citation?",
      "2026-07-11T01:02:00.000Z",
    );
    const legacyQuery = { ...query, traceHash: sha256Hex(query.agentSteps) };

    expect(verifyLedgerIntegrity(ledgerFor(legacyQuery)).ok).toBe(true);
  });

  it("records contribution payout amounts without changing the purchase price field", () => {
    const query = createQueryRecord(
      "How should AI agents pay publishers per citation?",
      "2026-07-11T01:03:00.000Z",
    );
    query.citations = query.citations.map((citation) => ({
      ...citation,
      payoutAtomicUsdc: 123,
    }));
    const ledger = ledgerFor(query);

    expect(ledger.receipts[0]?.amountAtomicUsdc).toBe(123);
    expect(ledger.queries[0]?.citations[0]?.amountAtomicUsdc).toBe(
      query.citations[0]?.amountAtomicUsdc,
    );
    expect(verifyLedgerIntegrity(ledger).ok).toBe(true);
  });
});
