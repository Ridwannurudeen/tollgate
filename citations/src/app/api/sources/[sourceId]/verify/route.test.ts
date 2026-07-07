import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./route";

const mocks = vi.hoisted(() => ({
  claimSourceAsCreator: vi.fn(),
  findSource: vi.fn(),
  releaseEscrowForSource: vi.fn(),
  verifySourceByWebProof: vi.fn(),
  verifySourceOwnership: vi.fn(),
}));

vi.mock("@/lib/catalog", () => {
  class SourceRegistryError extends Error {
    constructor(
      message: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  }

  return {
    SourceRegistryError,
    claimSourceAsCreator: mocks.claimSourceAsCreator,
    findSource: mocks.findSource,
    verifySourceOwnership: mocks.verifySourceOwnership,
  };
});

vi.mock("@/lib/escrow", () => ({
  releaseEscrowForSource: mocks.releaseEscrowForSource,
}));

vi.mock("@/lib/source-verification", () => ({
  verificationToken: () => "token",
  verifySourceByWebProof: mocks.verifySourceByWebProof,
}));

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://tollgate.test/api/sources/source-1/verify", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function context(sourceId = "source-1") {
  return {
    params: Promise.resolve({ sourceId }),
  };
}

const source = {
  id: "source-1",
  title: "Source One",
  creator: "Source Lab",
  handle: "@source",
  wallet: "0x7777777777777777777777777777777777777777",
  url: "https://example.com/source",
  summary: "Source summary.",
  tags: ["source"],
  priceAtomicUsdc: 1500,
  sourceKind: "external",
  creatorKind: "external",
  verifiedCreator: false,
  probation: true,
};

describe("PATCH /api/sources/[sourceId]/verify", () => {
  beforeEach(() => {
    mocks.claimSourceAsCreator.mockReset();
    mocks.findSource.mockReset();
    mocks.releaseEscrowForSource.mockReset();
    mocks.verifySourceByWebProof.mockReset();
    mocks.verifySourceOwnership.mockReset();
    mocks.findSource.mockResolvedValue(source);
    mocks.releaseEscrowForSource.mockResolvedValue({
      released: false,
      amountAtomicUsdc: 0,
      releasedReceiptHashes: [],
    });
  });

  it("routes creator-claimed verification through the claim branch", async () => {
    const claimedSource = {
      ...source,
      creatorClaimed: true,
      probation: false,
      ownershipProof: {
        method: "creator-claimed",
        verifiedAt: "2026-07-07T00:00:00.000Z",
      },
    };
    mocks.claimSourceAsCreator.mockResolvedValue({
      source: claimedSource,
      sources: [claimedSource],
    });
    mocks.releaseEscrowForSource.mockResolvedValue({
      released: true,
      amountAtomicUsdc: 1500,
      releasedReceiptHashes: ["0xrelease"],
    });

    const response = await PATCH(
      request({ method: "creator-claimed", attest: true }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.claimSourceAsCreator).toHaveBeenCalledWith("source-1", {
      method: "creator-claimed",
      attest: true,
    });
    expect(mocks.verifySourceOwnership).not.toHaveBeenCalled();
    expect(mocks.verifySourceByWebProof).not.toHaveBeenCalled();
    expect(mocks.releaseEscrowForSource).toHaveBeenCalledWith(claimedSource);
    expect(body.source.creatorClaimed).toBe(true);
    expect(body.source.verifiedCreator).toBe(false);
    expect(body.escrowRelease.released).toBe(true);
  });

  it("keeps wallet-signature verification on the existing probationary branch", async () => {
    const walletSignedSource = {
      ...source,
      ownershipProof: {
        method: "wallet-signature",
        signer: source.wallet,
        signatureHash: `0x${"ab".repeat(32)}`,
        verifiedAt: "2026-07-07T00:00:00.000Z",
      },
    };
    mocks.verifySourceOwnership.mockResolvedValue({
      source: walletSignedSource,
      sources: [walletSignedSource],
    });

    const response = await PATCH(
      request({
        method: "wallet-signature",
        ownershipSignature: "0x1234",
        ownershipTimestamp: "2026-07-07T00:00:00.000Z",
      }),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.verifySourceOwnership).toHaveBeenCalled();
    expect(mocks.claimSourceAsCreator).not.toHaveBeenCalled();
    expect(body.source.verifiedCreator).toBe(false);
    expect(body.source.probation).toBe(true);
    expect(body.escrowRelease.released).toBe(false);
  });

  it("keeps domain proof on the web-proof branch", async () => {
    const verifiedSource = {
      ...source,
      verifiedCreator: true,
      probation: false,
      ownershipProof: {
        method: "meta-tag",
        verifiedAt: "2026-07-07T00:00:00.000Z",
      },
    };
    mocks.verifySourceByWebProof.mockResolvedValue({
      source: verifiedSource,
      sources: [verifiedSource],
    });

    const response = await PATCH(request({ method: "meta-tag" }), context());

    expect(response.status).toBe(200);
    expect(mocks.verifySourceByWebProof).toHaveBeenCalledWith(
      source,
      "meta-tag",
    );
    expect(mocks.claimSourceAsCreator).not.toHaveBeenCalled();
  });
});
