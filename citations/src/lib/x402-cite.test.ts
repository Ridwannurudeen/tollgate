import { describe, expect, it } from "vitest";
import { createQueryRecord } from "./engine";
import { createReceipts } from "./ledger";
import {
  X402_CITE_RECEIPT_HEADER,
  buildX402CiteReceipt,
  buildX402CiteToll,
  decodeX402CiteHeader,
  encodeX402CiteHeader,
  x402CiteReceiptHash,
  type X402CiteReceipt,
  type X402CiteToll,
} from "./x402-cite";
import type { CreatorSource } from "./types";

describe("x402-Cite helpers", () => {
  it("round-trips a citation toll header", () => {
    const source: CreatorSource = {
      id: "circle-gateway-nano",
      title: "Circle Gateway Notes",
      creator: "Circle Developer Notes",
      handle: "@circle",
      wallet: "0x1111111111111111111111111111111111111111",
      url: "https://example.com/circle",
      summary: "Gateway batching for tiny payments.",
      tags: ["x402", "gateway"],
      priceAtomicUsdc: 1800,
      sourceKind: "internal-test",
      creatorKind: "internal-test",
      verifiedCreator: false,
    };
    const toll = buildX402CiteToll(
      source,
      "https://example.com/api/sources/circle-gateway-nano",
    );
    const header = encodeX402CiteHeader(toll);

    expect(decodeX402CiteHeader<X402CiteToll>(header)).toEqual(toll);
  });

  it("builds a receipt bound to the answer receipt hash", () => {
    const query = createQueryRecord(
      "How should agents pay creators with x402?",
      "2026-06-23T00:00:00.000Z",
    );
    const receipt = createReceipts(query, [])[0];
    const citeReceipt = buildX402CiteReceipt(query, receipt);

    expect(citeReceipt.answerHash).toBe(query.answerHash);
    expect(citeReceipt.receiptHash).toBe(receipt.receiptHash);
    expect(x402CiteReceiptHash(citeReceipt)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(X402_CITE_RECEIPT_HEADER).toBe("X-402-Cite-Receipt");
  });

  it("round-trips an x402-Cite receipt header", () => {
    const receipt: X402CiteReceipt = {
      version: "x402-cite/0.1",
      queryId: "query-1",
      sourceId: "source-1",
      answerHash: `0x${"a".repeat(64)}`,
      receiptHash: `0x${"b".repeat(64)}`,
      amountAtomicUsdc: 1200,
      settlementMode: "x402-verified",
      paidAt: "2026-06-23T00:00:00.000Z",
    };

    expect(
      decodeX402CiteHeader<X402CiteReceipt>(encodeX402CiteHeader(receipt)),
    ).toEqual(receipt);
  });
});
