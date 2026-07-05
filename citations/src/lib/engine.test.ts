import { describe, expect, it } from "vitest";
import { queryPaymentEconomics } from "./economics";
import {
  createQueryRecord,
  NO_SOURCE_ANSWER,
  planCitationMarket,
} from "./engine";
import type { CreatorSource, QueryPaymentEvidence } from "./types";

const IRRELEVANT_SOURCES: CreatorSource[] = [
  {
    id: "forum-mandates-test",
    title: "Forum Mandates",
    creator: "Forum Labs",
    handle: "@forum",
    wallet: "0x1111111111111111111111111111111111111111",
    url: "https://example.com/forum",
    summary: "Agent budgets, receipts, and x402 payment policy.",
    tags: ["agents", "payments"],
    priceAtomicUsdc: 1_500,
    sourceKind: "internal-test",
    creatorKind: "internal-test",
    verifiedCreator: true,
  },
  {
    id: "arc-finality-test",
    title: "Arc Finality",
    creator: "Arc Research",
    handle: "@arc",
    wallet: "0x2222222222222222222222222222222222222222",
    url: "https://example.com/arc",
    summary: "USDC settlement finality for agent commerce.",
    tags: ["usdc", "settlement"],
    priceAtomicUsdc: 2_200,
    sourceKind: "internal-test",
    creatorKind: "internal-test",
    verifiedCreator: true,
  },
];

const READER_PAYMENT: QueryPaymentEvidence = {
  amountAtomicUsdc: 10_000,
  settlementMode: "x402-settled",
  payTo: "0x3333333333333333333333333333333333333333",
  payer: "0x4444444444444444444444444444444444444444",
  paymentResource: "/api/paid-query",
  paymentHash: "reader-payment-hash",
};

describe("no-source answers", () => {
  it("does not force-buy a source when no registered source is relevant", () => {
    const market = planCitationMarket(
      "What is the best chocolate chip cookie recipe?",
      IRRELEVANT_SOURCES,
    );

    expect(market.selectedSources).toEqual([]);
    expect(market.budget).toMatchObject({
      spentAtomicUsdc: 0,
      remainingAtomicUsdc: 6_500,
      purchasedCount: 0,
      candidateCount: 2,
    });
    expect(market.decisions.every((decision) => !decision.selected)).toBe(true);
    expect(market.decisions.every((decision) => decision.score === 0)).toBe(
      true,
    );
  });

  it("creates an honest deterministic decline with no creator payout", () => {
    const query = createQueryRecord(
      "What is the best chocolate chip cookie recipe?",
      "2026-07-05T00:00:00.000Z",
      IRRELEVANT_SOURCES,
      READER_PAYMENT,
    );
    const economics = queryPaymentEconomics(query);

    expect(query.answer).toBe(NO_SOURCE_ANSWER);
    expect(query.citations).toEqual([]);
    expect(query.receiptHashes).toEqual([]);
    expect(query.totalAtomicUsdc).toBe(0);
    expect(query.agentBudget).toMatchObject({
      spentAtomicUsdc: 0,
      remainingAtomicUsdc: 6_500,
      purchasedCount: 0,
      candidateCount: 2,
    });
    expect(query.agentRationale).toContain("found no registered source");
    expect(query.agentSteps?.map((step) => step.name)).toEqual([
      "appraise",
      "allocate",
      "draft",
    ]);
    expect(economics.creatorPayoutsAtomicUsdc).toBe(0);
    expect(economics.readerPaidAtomicUsdc).toBe(10_000);
    expect(economics.protocolRetainedAtomicUsdc).toBe(10_000);
  });
});
