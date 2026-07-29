import { describe, expect, it } from "vitest";
import { pendingEscrowReceipts, shouldEscrowSource } from "./escrow";
import type { CreatorSource, PaymentReceipt } from "./types";

function receipt(overrides: Partial<PaymentReceipt>): PaymentReceipt {
  return {
    id: "receipt-1",
    queryId: "query-1",
    sourceId: "source-a",
    creator: "External Lab",
    wallet: "0x7777777777777777777777777777777777777777",
    amountAtomicUsdc: 1_000,
    settlementMode: "escrowed",
    payoutPolicy: "escrow-unverified",
    previousHash: "0x00",
    receiptHash: "0xaa",
    createdAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

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

  it("keeps historical creator-claimed external sources in escrow", () => {
    const previous = process.env.TOLLGATE_ESCROW_UNVERIFIED;
    delete process.env.TOLLGATE_ESCROW_UNVERIFIED;

    try {
      expect(
        shouldEscrowSource({
          ...externalUnverifiedSource,
          creatorClaimed: true,
          probation: false,
          ownershipProof: {
            method: "creator-claimed",
            verifiedAt: "2026-07-07T00:00:00.000Z",
          },
        }),
      ).toBe(true);
    } finally {
      restoreEnv(previous);
    }
  });

  it("still escrows wallet-signature-only sources on probation", () => {
    const previous = process.env.TOLLGATE_ESCROW_UNVERIFIED;
    delete process.env.TOLLGATE_ESCROW_UNVERIFIED;

    try {
      expect(
        shouldEscrowSource({
          ...externalUnverifiedSource,
          probation: true,
          ownershipProof: {
            method: "wallet-signature",
            signer: externalUnverifiedSource.wallet,
            signatureHash: `0x${"ab".repeat(32)}`,
            verifiedAt: "2026-07-07T00:00:00.000Z",
          },
        }),
      ).toBe(true);
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

describe("pending escrow receipts", () => {
  it("reports escrowed receipts awaiting verification for the source", () => {
    const receipts = [
      receipt({ receiptHash: "0xaa", amountAtomicUsdc: 1_000 }),
      receipt({ receiptHash: "0xbb", amountAtomicUsdc: 500 }),
    ];
    const pending = pendingEscrowReceipts(receipts, "source-a");
    expect(pending.map((entry) => entry.receiptHash)).toEqual(["0xaa", "0xbb"]);
    expect(
      pending.reduce((sum, entry) => sum + entry.amountAtomicUsdc, 0),
    ).toBe(1_500);
  });

  it("excludes receipts a previous release already paid out", () => {
    const receipts = [
      receipt({ receiptHash: "0xaa" }),
      receipt({ receiptHash: "0xbb" }),
      receipt({
        receiptHash: "0xcc",
        settlementMode: "forum-routed",
        payoutPolicy: "escrow-release",
        releasedReceiptHashes: ["0xaa"],
      }),
    ];
    expect(
      pendingEscrowReceipts(receipts, "source-a").map(
        (entry) => entry.receiptHash,
      ),
    ).toEqual(["0xbb"]);
  });

  it("ignores other sources and non-escrowed settlements", () => {
    const receipts = [
      receipt({ receiptHash: "0xaa", sourceId: "source-b" }),
      receipt({
        receiptHash: "0xbb",
        settlementMode: "forum-routed",
        payoutPolicy: undefined,
      }),
      receipt({ receiptHash: "0xcc" }),
    ];
    expect(
      pendingEscrowReceipts(receipts, "source-a").map(
        (entry) => entry.receiptHash,
      ),
    ).toEqual(["0xcc"]);
  });
});
