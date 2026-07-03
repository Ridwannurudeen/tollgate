import { describe, expect, it } from "vitest";
import { groundingYield, groundingYieldsBySource } from "./grounding-yield";
import type { Ledger, PaymentReceipt } from "./types";

function hash(seed: string): `0x${string}` {
  return `0x${seed.repeat(64)}`;
}

function receipt(
  sourceId: string,
  settlementMode: PaymentReceipt["settlementMode"] = "local-proof",
): PaymentReceipt {
  return {
    id: `${sourceId}-${settlementMode}`,
    queryId: `query-${sourceId}`,
    sourceId,
    creator: "Yield Lab",
    wallet: "0x1111111111111111111111111111111111111111",
    amountAtomicUsdc: 1_000,
    settlementMode,
    previousHash: hash("0"),
    receiptHash: hash(sourceId.slice(0, 1) || "1"),
    createdAt: "2026-07-03T00:00:00.000Z",
  };
}

describe("grounding yield", () => {
  it("starts cold sources at 0.5", () => {
    const ledger: Ledger = { queries: [], receipts: [] };

    expect(groundingYield(ledger, "cold-source")).toEqual({
      sourceId: "cold-source",
      used: 0,
      bought: 0,
      value: 0.5,
    });
  });

  it("counts refunded receipts as bought but not used", () => {
    const ledger: Ledger = {
      queries: [],
      receipts: [
        receipt("refund-heavy", "local-proof"),
        receipt("refund-heavy", "refunded"),
        receipt("refund-heavy", "refunded"),
      ],
    };

    expect(groundingYield(ledger, "refund-heavy")).toEqual({
      sourceId: "refund-heavy",
      used: 1,
      bought: 3,
      value: 0.4,
    });
  });

  it("builds a yield map for sources with receipts", () => {
    const ledger: Ledger = {
      queries: [],
      receipts: [
        receipt("kept", "local-proof"),
        receipt("kept", "escrowed"),
        receipt("unused", "refunded"),
      ],
    };

    const yields = groundingYieldsBySource(ledger);

    expect(yields.get("kept")).toMatchObject({
      sourceId: "kept",
      used: 2,
      bought: 2,
      value: 0.75,
    });
    expect(yields.get("unused")).toMatchObject({
      sourceId: "unused",
      used: 0,
      bought: 1,
      value: 1 / 3,
    });
    expect(yields.has("cold")).toBe(false);
  });
});
