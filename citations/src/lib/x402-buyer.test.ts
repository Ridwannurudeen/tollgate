import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import { ARC_CAIP2 } from "./chain";
import {
  externalSpendOnDate,
  parseX402Endpoints,
  selectAffordableRequirement,
} from "./x402-buyer";
import type { Ledger, QueryRecord } from "./types";

function requirement(
  amount: string,
  network: string = ARC_CAIP2,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: network as PaymentRequirements["network"],
    asset: "0x3600000000000000000000000000000000000000",
    amount,
    payTo: "0x1111111111111111111111111111111111111111",
    maxTimeoutSeconds: 60,
    extra: {},
  };
}

function query(overrides: Partial<QueryRecord>): QueryRecord {
  return {
    id: "query-1",
    question: "q",
    answer: "a",
    queryHash: "0x01",
    answerHash: "0x02",
    totalAtomicUsdc: 0,
    citations: [],
    receiptHashes: [],
    createdAt: "2026-07-29T10:00:00.000Z",
    ...overrides,
  };
}

const ledger = (queries: QueryRecord[]): Ledger => ({ queries, receipts: [] });

describe("x402 endpoint allowlist", () => {
  it("treats an unset allowlist as no external endpoints", () => {
    expect(parseX402Endpoints(undefined)).toEqual([]);
    expect(parseX402Endpoints("  ")).toEqual([]);
  });

  it("parses a well-formed allowlist", () => {
    const parsed = parseX402Endpoints(
      JSON.stringify([
        {
          id: "crux",
          label: "Crux",
          url: "https://crux.example/api/ask",
          maxPriceAtomicUsdc: 2_000,
        },
      ]),
    );
    expect(parsed).toEqual([
      {
        id: "crux",
        label: "Crux",
        url: "https://crux.example/api/ask",
        maxPriceAtomicUsdc: 2_000,
      },
    ]);
  });

  it("rejects a non-https endpoint", () => {
    expect(() =>
      parseX402Endpoints(
        JSON.stringify([
          {
            id: "crux",
            label: "Crux",
            url: "http://crux.example/api/ask",
            maxPriceAtomicUsdc: 2_000,
          },
        ]),
      ),
    ).toThrow("must be an https URL");
  });

  it("rejects a missing or non-positive price cap", () => {
    expect(() =>
      parseX402Endpoints(
        JSON.stringify([
          { id: "crux", label: "Crux", url: "https://crux.example/api/ask" },
        ]),
      ),
    ).toThrow("maxPriceAtomicUsdc must be a positive integer.");
    expect(() =>
      parseX402Endpoints(
        JSON.stringify([
          {
            id: "crux",
            label: "Crux",
            url: "https://crux.example/api/ask",
            maxPriceAtomicUsdc: 0,
          },
        ]),
      ),
    ).toThrow("maxPriceAtomicUsdc must be a positive integer.");
  });

  it("rejects malformed JSON rather than silently disabling the cap", () => {
    expect(() => parseX402Endpoints("{not json")).toThrow(
      "must be valid JSON.",
    );
  });
});

describe("x402 payment requirement selection", () => {
  it("authorises only the cheapest requirement within the cap", () => {
    const selected = selectAffordableRequirement(
      [requirement("1500"), requirement("400"), requirement("900")],
      2_000,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].amount).toBe("400");
  });

  it("authorises nothing when every requirement exceeds the cap", () => {
    expect(selectAffordableRequirement([requirement("5000")], 2_000)).toEqual(
      [],
    );
  });

  it("ignores requirements on another network", () => {
    expect(
      selectAffordableRequirement([requirement("100", "eip155:8453")], 2_000),
    ).toEqual([]);
  });
});

describe("external spend accounting", () => {
  it("sums only assists recorded on the given day", () => {
    const spend = externalSpendOnDate(
      ledger([
        query({
          id: "a",
          createdAt: "2026-07-29T01:00:00.000Z",
          externalAssists: [
            {
              provider: "x402:crux",
              endpoint: "https://crux.example/api/ask",
              amountAtomicUsdc: 400,
              transaction: `0x${"1".repeat(64)}`,
              answerHash: "0x03",
            },
          ],
        }),
        query({
          id: "b",
          createdAt: "2026-07-28T23:00:00.000Z",
          externalAssists: [
            {
              provider: "x402:crux",
              endpoint: "https://crux.example/api/ask",
              amountAtomicUsdc: 9_000,
              transaction: `0x${"2".repeat(64)}`,
              answerHash: "0x04",
            },
          ],
        }),
        query({ id: "c", createdAt: "2026-07-29T05:00:00.000Z" }),
      ]),
      "2026-07-29",
    );
    expect(spend).toBe(400);
  });

  it("reports zero when nothing was spent externally", () => {
    expect(externalSpendOnDate(ledger([query({})]), "2026-07-29")).toBe(0);
  });
});
