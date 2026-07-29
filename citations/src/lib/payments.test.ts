import { afterEach, describe, expect, it } from "vitest";
import {
  claimPriceAtomicUsdc,
  claimSettlement,
  DEFAULT_CLAIM_PRICE_ATOMIC_USDC,
  PAID_QUERY_PRICE_ATOMIC_USDC,
} from "./payments";

afterEach(() => {
  delete process.env.LEPTONWEB_CLAIM_PRICE_ATOMIC;
});

describe("claim price configuration", () => {
  it("falls back to the default when unset or malformed", () => {
    delete process.env.LEPTONWEB_CLAIM_PRICE_ATOMIC;
    expect(claimPriceAtomicUsdc()).toBe(DEFAULT_CLAIM_PRICE_ATOMIC_USDC);
    process.env.LEPTONWEB_CLAIM_PRICE_ATOMIC = "not-a-number";
    expect(claimPriceAtomicUsdc()).toBe(DEFAULT_CLAIM_PRICE_ATOMIC_USDC);
    process.env.LEPTONWEB_CLAIM_PRICE_ATOMIC = "0";
    expect(claimPriceAtomicUsdc()).toBe(DEFAULT_CLAIM_PRICE_ATOMIC_USDC);
  });

  it("honours a configured nanopayment rate", () => {
    process.env.LEPTONWEB_CLAIM_PRICE_ATOMIC = "1";
    expect(claimPriceAtomicUsdc()).toBe(1);
  });
});

describe("claim-priced reader settlement", () => {
  it("charges per supported claim and refunds the rest of the ceiling", () => {
    expect(
      claimSettlement({
        supportedClaimCount: 3,
        creatorPayoutAtomicUsdc: 1_000,
        quotedAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
        claimPriceAtomicUsdc: 1_000,
      }),
    ).toEqual({ chargeAtomicUsdc: 3_000, refundAtomicUsdc: 7_000 });
  });

  it("never settles below what creators were already paid", () => {
    // One supported claim would price at 1_000, but 4_500 already left the
    // agent wallet for creators, so the reader is charged the floor.
    expect(
      claimSettlement({
        supportedClaimCount: 1,
        creatorPayoutAtomicUsdc: 4_500,
        quotedAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
        claimPriceAtomicUsdc: 1_000,
      }),
    ).toEqual({ chargeAtomicUsdc: 4_500, refundAtomicUsdc: 5_500 });
  });

  it("charges the creator floor when no claim survived verification", () => {
    expect(
      claimSettlement({
        supportedClaimCount: 0,
        creatorPayoutAtomicUsdc: 1_500,
        quotedAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
        claimPriceAtomicUsdc: 1_000,
      }),
    ).toEqual({ chargeAtomicUsdc: 1_500, refundAtomicUsdc: 8_500 });
  });

  it("never charges more than the reader authorised", () => {
    expect(
      claimSettlement({
        supportedClaimCount: 40,
        creatorPayoutAtomicUsdc: 6_500,
        quotedAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
        claimPriceAtomicUsdc: 1_000,
      }),
    ).toEqual({
      chargeAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
      refundAtomicUsdc: 0,
    });
  });

  it("reaches the nanopayment floor once creator cost is nanopriced too", () => {
    expect(
      claimSettlement({
        supportedClaimCount: 2,
        creatorPayoutAtomicUsdc: 0,
        quotedAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
        claimPriceAtomicUsdc: 1,
      }),
    ).toEqual({ chargeAtomicUsdc: 2, refundAtomicUsdc: 9_998 });
  });

  it("treats negative inputs as zero rather than inverting the refund", () => {
    expect(
      claimSettlement({
        supportedClaimCount: -5,
        creatorPayoutAtomicUsdc: -100,
        quotedAtomicUsdc: 1_000,
        claimPriceAtomicUsdc: 10,
      }),
    ).toEqual({ chargeAtomicUsdc: 0, refundAtomicUsdc: 1_000 });
  });
});
