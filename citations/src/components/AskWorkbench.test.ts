import { describe, expect, it } from "vitest";
import { paidQueryErrorMessage } from "./AskWorkbench";

describe("paidQueryErrorMessage", () => {
  it("explains the missing injected wallet path", () => {
    expect(
      paidQueryErrorMessage(new Error("No injected wallet found."), "$0.01"),
    ).toBe(
      "No wallet detected. Install MetaMask (or any Arc-compatible wallet) and try again.",
    );
  });

  it("explains wallet rejection with the live price text", () => {
    const error = Object.assign(new Error("User rejected the request."), {
      code: 4001,
    });

    expect(paidQueryErrorMessage(error, "$0.01")).toBe(
      "Payment cancelled - approve the wallet prompt to pay $0.01 and get your answer.",
    );
  });

  it("points insufficient Arc-testnet USDC failures to the faucet", () => {
    expect(
      paidQueryErrorMessage(
        new Error("invalid_exact_evm_insufficient_balance"),
        "$0.01",
      ),
    ).toBe(
      "Your wallet needs a little Arc-testnet USDC. Get it free at faucet.circle.com, then retry.",
    );
  });

  it("keeps unknown payment errors visible", () => {
    expect(
      paidQueryErrorMessage(new Error("settlement unavailable"), "$0.01"),
    ).toBe("settlement unavailable");
  });
});
