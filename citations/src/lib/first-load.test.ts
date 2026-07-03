import { describe, expect, it } from "vitest";
import {
  recentReceiptTickerReceipts,
  verifiedExternalCreatorSources,
} from "./first-load";
import type { CreatorSource, PaymentReceipt } from "./types";

function receipt(id: string, createdAt: string): PaymentReceipt {
  return {
    id,
    queryId: "query",
    sourceId: "source",
    creator: id,
    wallet: "0x1111111111111111111111111111111111111111",
    amountAtomicUsdc: 1000,
    settlementMode: "forum-routed",
    previousHash: `0xprev-${id}`,
    receiptHash: `0xreceipt-${id}`,
    createdAt,
  };
}

function source(
  id: string,
  creatorKind: CreatorSource["creatorKind"],
  verifiedCreator: boolean,
): CreatorSource {
  return {
    id,
    title: `${id} title`,
    creator: `${id} creator`,
    handle: `@${id}`,
    wallet: "0x1111111111111111111111111111111111111111",
    url: `https://example.com/${id}`,
    summary: `${id} summary`,
    tags: ["agents"],
    priceAtomicUsdc: 1000,
    sourceKind: creatorKind,
    creatorKind,
    verifiedCreator,
  };
}

describe("first-load helpers", () => {
  it("orders ticker receipts newest first with append order as a tie-breaker", () => {
    const receipts = [
      receipt("old", "2026-07-03T10:00:00.000Z"),
      receipt("tie-a", "2026-07-03T12:00:00.000Z"),
      receipt("tie-b", "2026-07-03T12:00:00.000Z"),
      receipt("new", "2026-07-03T13:00:00.000Z"),
    ];

    expect(
      recentReceiptTickerReceipts(receipts, 3).map((item) => item.id),
    ).toEqual(["new", "tie-b", "tie-a"]);
  });

  it("returns only verified external creators for the first-load strip", () => {
    const sources = [
      source("seed", "seed", true),
      source("external-a", "external", true),
      source("external-b", "external", false),
      source("external-c", "external", true),
      source("external-d", "external", true),
      source("external-e", "external", true),
    ];

    expect(
      verifiedExternalCreatorSources(sources).map((item) => item.id),
    ).toEqual(["external-a", "external-c", "external-d"]);
  });
});
