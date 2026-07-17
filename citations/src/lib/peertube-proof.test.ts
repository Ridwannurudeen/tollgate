import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPeerTubeProof } from "./peertube-proof";

const mocks = vi.hoisted(() => ({
  getTransaction: vi.fn(),
  getTransactionReceipt: vi.fn(),
}));

vi.mock("viem", async () => {
  const actual = await vi.importActual<typeof import("viem")>("viem");
  return {
    ...actual,
    createPublicClient: () => ({
      getTransaction: mocks.getTransaction,
      getTransactionReceipt: mocks.getTransactionReceipt,
    }),
  };
});

describe("PeerTube public proof", () => {
  beforeEach(() => {
    mocks.getTransaction.mockReset();
    mocks.getTransactionReceipt.mockReset();
    const error = new Error(
      "Contact operator@example.com at http://127.0.0.1:8545.",
    );
    mocks.getTransaction.mockRejectedValue(error);
    mocks.getTransactionReceipt.mockRejectedValue(error);
  });

  it("redacts upstream error text in the public proof", async () => {
    const proof = await buildPeerTubeProof();
    const payload = JSON.stringify(proof);

    expect(payload).not.toContain("operator@example.com");
    expect(payload).not.toContain("127.0.0.1");
  });
});
