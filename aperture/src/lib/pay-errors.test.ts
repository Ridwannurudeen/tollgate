import { describe, expect, it } from "vitest";
import { CIRCLE_FAUCET_URL, payErrorMessage } from "./pay-errors";

describe("payErrorMessage", () => {
  it("explains missing injected wallets", () => {
    expect(
      payErrorMessage(new Error("No injected wallet found."), "0.0025 USDC"),
    ).toContain("No wallet detected");
  });

  it("explains rejected wallet prompts", () => {
    expect(payErrorMessage({ code: 4001 }, "0.0025 USDC")).toContain(
      "Payment cancelled",
    );
  });

  it("points low-balance buyers to the Circle faucet", () => {
    expect(
      payErrorMessage(new Error("insufficient funds"), "0.0025 USDC"),
    ).toContain(CIRCLE_FAUCET_URL);
  });

  it("does not leak raw fallback errors", () => {
    expect(
      payErrorMessage(new Error("RPC stack trace 123"), "0.0025 USDC"),
    ).not.toContain("RPC stack trace");
  });
});
