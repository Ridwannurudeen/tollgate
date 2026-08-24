import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  feeRouterAllowanceCeiling,
  feeRouterAllowanceTarget,
} from "./fee-router-allowance";

let previousAllowance: string | undefined;

beforeEach(() => {
  previousAllowance =
    process.env.LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC;
  delete process.env.LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC;
});

afterEach(() => {
  if (previousAllowance === undefined) {
    delete process.env.LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC;
  } else {
    process.env.LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC = previousAllowance;
  }
});

describe("FeeRouter allowance policy", () => {
  it("uses a one USDC ceiling by default", () => {
    expect(feeRouterAllowanceCeiling()).toBe(1_000_000n);
    process.env.LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC = "  ";
    expect(feeRouterAllowanceCeiling()).toBe(1_000_000n);
  });

  it("accepts a positive atomic USDC override", () => {
    process.env.LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC = "2500000";

    expect(feeRouterAllowanceCeiling()).toBe(2_500_000n);
  });

  it.each(["0", "-1", "1.5", "nope", (1n << 256n).toString()])(
    "rejects invalid ceiling %s",
    (value) => {
      process.env.LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC = value;

      expect(() => feeRouterAllowanceCeiling()).toThrow(
        "LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC",
      );
    },
  );

  it("returns one fixed target for every payment within the ceiling", () => {
    expect(feeRouterAllowanceTarget(1n)).toBe(1_000_000n);
    expect(feeRouterAllowanceTarget(1_000_000n)).toBe(1_000_000n);
  });

  it("rejects a payment above the ceiling", () => {
    expect(() => feeRouterAllowanceTarget(1_000_001n)).toThrow(
      "exceeds the FeeRouter allowance ceiling",
    );
  });
});
