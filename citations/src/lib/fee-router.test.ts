import { describe, expect, it } from "vitest";
import { createQueryRecord } from "./engine";
import { assertValidFeeRouterSplit, routeCitationPayments } from "./fee-router";

describe("assertValidFeeRouterSplit", () => {
  it("accepts a 10000 bps split", () => {
    expect(() =>
      assertValidFeeRouterSplit(
        ["0x7777777777777777777777777777777777777777"],
        [10_000],
      ),
    ).not.toThrow();
  });

  it("rejects mismatched recipients and bps", () => {
    expect(() =>
      assertValidFeeRouterSplit(
        ["0x7777777777777777777777777777777777777777"],
        [5_000, 5_000],
      ),
    ).toThrow("length mismatch");
  });

  it("rejects splits that do not sum to 10000 bps", () => {
    expect(() =>
      assertValidFeeRouterSplit(
        ["0x7777777777777777777777777777777777777777"],
        [9_999],
      ),
    ).toThrow("sum to 10000");
  });

  it("returns no receipt evidence when FeeRouter settlement is disabled", async () => {
    const query = createQueryRecord(
      "How should Forum route paid citation receipts?",
      "2026-06-23T00:00:00.000Z",
    );

    await expect(
      routeCitationPayments(query, { enabled: false }),
    ).resolves.toEqual({});
  });

  it("requires a runtime private key when FeeRouter settlement is enabled", async () => {
    const query = createQueryRecord(
      "How should Forum route paid citation receipts?",
      "2026-06-23T00:00:00.000Z",
    );

    await expect(
      routeCitationPayments(query, { enabled: true }),
    ).rejects.toThrow("LEPTONWEB_FEE_ROUTER_PRIVATE_KEY");
  });
});
