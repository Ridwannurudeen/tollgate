import { describe, expect, it } from "vitest";
import { createQueryRecord } from "./engine";
import { claimSupportRoot, scoreContribution } from "./contribution";
import { sha256Hex } from "./hash";
import { createReceipts, verifyLedgerIntegrity } from "./ledger";
import { createQueryPaymentEvidence } from "./settlement";
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

  it("rejects tampered claim support and contribution payouts", () => {
    const base = createQueryRecord(
      "How should AI agents prove useful citation payouts?",
      "2026-07-11T01:04:00.000Z",
    );
    const citation = base.citations[0];
    if (!citation) throw new Error("missing contribution citation");
    const claimSupport = [
      {
        claim: "A useful citation binds a claim to stored evidence.",
        sourceId: citation.sourceId,
        span: "stored evidence",
        status: "supported" as const,
      },
    ];
    const contributionScores = scoreContribution(
      claimSupport,
      citation.amountAtomicUsdc,
      { [citation.sourceId]: citation.amountAtomicUsdc },
    );
    const query: QueryRecord = {
      ...base,
      citations: [
        {
          ...citation,
          payoutAtomicUsdc: contributionScores[0]?.rewardAtomicUsdc,
        },
      ],
      claimSupport,
      contributionScores,
      claimSupportRoot: claimSupportRoot(claimSupport),
    };
    const ledger = ledgerFor(query);

    expect(verifyLedgerIntegrity(ledger).ok).toBe(true);
    expect(
      verifyLedgerIntegrity({
        ...ledger,
        queries: [
          {
            ...ledger.queries[0],
            claimSupport: [{ ...claimSupport[0], span: "tampered span" }],
          } as QueryRecord,
        ],
      }).issues.some((issue) => issue.reason.includes("claim-support root")),
    ).toBe(true);
    expect(
      verifyLedgerIntegrity({
        ...ledger,
        queries: [
          {
            ...ledger.queries[0],
            contributionScores: [
              {
                ...contributionScores[0],
                rewardAtomicUsdc:
                  (contributionScores[0]?.rewardAtomicUsdc ?? 0) + 1,
              },
            ],
          } as QueryRecord,
        ],
      }).issues.some((issue) => issue.reason.includes("contribution scores")),
    ).toBe(true);
  });

  it("keeps post-hoc actor and refund metadata outside the payment hash", () => {
    const payment = createQueryPaymentEvidence({
      amountAtomicUsdc: 1_000,
      settlementMode: "x402-settled",
      payTo: "0x1111111111111111111111111111111111111111",
      payer: "0x2222222222222222222222222222222222222222",
      transaction: `0x${"3".repeat(64)}`,
      paymentResource: "/api/paid-query",
    });
    const query = createQueryRecord(
      "How should payment evidence keep administrative metadata additive?",
      "2026-07-11T01:05:00.000Z",
      undefined,
      {
        ...payment,
        actorClass: "external-agent",
        refundFailure: {
          reason: "no-answer",
          message: "Reader refund is not configured or funded.",
        },
      },
    );

    expect(verifyLedgerIntegrity(ledgerFor(query)).ok).toBe(true);
  });
});
