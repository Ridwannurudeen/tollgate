import { describe, expect, it } from "vitest";
import { shouldEscrowSource } from "./escrow";
import type { CreatorSource } from "./types";

const externalUnverifiedSource: CreatorSource = {
  id: "unverified-external",
  title: "Unverified External",
  creator: "External Lab",
  handle: "@external",
  wallet: "0x7777777777777777777777777777777777777777",
  url: "https://example.com/unverified",
  summary: "External source for escrow tests.",
  tags: ["escrow"],
  priceAtomicUsdc: 1_000,
  sourceKind: "external",
  creatorKind: "external",
  verifiedCreator: false,
};

function restoreEnv(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
  } else {
    process.env.TOLLGATE_ESCROW_UNVERIFIED = previous;
  }
}

describe("escrow source policy", () => {
  it("escrows unverified external sources by default", () => {
    const previous = process.env.TOLLGATE_ESCROW_UNVERIFIED;
    delete process.env.TOLLGATE_ESCROW_UNVERIFIED;

    try {
      expect(shouldEscrowSource(externalUnverifiedSource)).toBe(true);
    } finally {
      restoreEnv(previous);
    }
  });

  it("allows direct payment only when escrow is explicitly disabled", () => {
    const previous = process.env.TOLLGATE_ESCROW_UNVERIFIED;
    process.env.TOLLGATE_ESCROW_UNVERIFIED = "0";

    try {
      expect(shouldEscrowSource(externalUnverifiedSource)).toBe(false);
    } finally {
      restoreEnv(previous);
    }
  });
});
