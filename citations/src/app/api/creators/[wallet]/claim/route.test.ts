import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  assertClaimRateLimit: vi.fn(),
  readFeeRouterClaimable: vi.fn(),
  readSources: vi.fn(),
  w3sExecuteContract: vi.fn(),
}));

vi.mock("@/lib/catalog", () => ({
  readSources: mocks.readSources,
}));

vi.mock("@/lib/circle-w3s", () => ({
  w3sExecuteContract: mocks.w3sExecuteContract,
}));

vi.mock("@/lib/fee-router", () => ({
  readFeeRouterClaimable: mocks.readFeeRouterClaimable,
}));

vi.mock("@/lib/fee-router-contract", () => ({
  FEE_ROUTER_ADDRESS: "0x1111111111111111111111111111111111111111",
  feeRouterV1Abi: [],
}));

vi.mock("@/lib/rate-limit", () => ({
  assertClaimRateLimit: mocks.assertClaimRateLimit,
}));

const wallet = "0x7777777777777777777777777777777777777777";

function request(): NextRequest {
  return new NextRequest(`http://tollgate.test/api/creators/${wallet}/claim`, {
    method: "POST",
    headers: { "x-forwarded-for": "198.51.100.20" },
  });
}

function context() {
  return {
    params: Promise.resolve({ wallet }),
  };
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: "source-1",
    title: "Source One",
    creator: "Source Lab",
    handle: "@source",
    wallet,
    url: "https://example.com/source",
    summary: "Source summary.",
    tags: ["source"],
    priceAtomicUsdc: 1500,
    sourceKind: "external",
    creatorKind: "external",
    verifiedCreator: false,
    custody: "circle-w3s",
    walletId: "wallet-id",
    ...overrides,
  };
}

function setCircleEnv(): () => void {
  const previousKey = process.env.CIRCLE_API_KEY;
  const previousSecret = process.env.CIRCLE_ENTITY_SECRET;
  process.env.CIRCLE_API_KEY = "test-key";
  process.env.CIRCLE_ENTITY_SECRET = "test-secret";
  return () => {
    if (previousKey === undefined) {
      delete process.env.CIRCLE_API_KEY;
    } else {
      process.env.CIRCLE_API_KEY = previousKey;
    }
    if (previousSecret === undefined) {
      delete process.env.CIRCLE_ENTITY_SECRET;
    } else {
      process.env.CIRCLE_ENTITY_SECRET = previousSecret;
    }
  };
}

describe("POST /api/creators/[wallet]/claim", () => {
  beforeEach(() => {
    mocks.assertClaimRateLimit.mockReset();
    mocks.readFeeRouterClaimable.mockReset();
    mocks.readSources.mockReset();
    mocks.w3sExecuteContract.mockReset();
  });

  it("allows creator-claimed custodial wallets to claim released funds", async () => {
    const restoreEnv = setCircleEnv();
    mocks.readSources.mockResolvedValue([
      source({
        creatorClaimed: true,
        probation: false,
        ownershipProof: {
          method: "creator-claimed",
          verifiedAt: "2026-07-07T00:00:00.000Z",
        },
      }),
    ]);
    mocks.readFeeRouterClaimable.mockResolvedValue(2500n);
    mocks.w3sExecuteContract.mockResolvedValue("0xclaim");

    try {
      const response = await POST(request(), context());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        claimed: true,
        claimableAtomicUsdc: "2500",
        transaction: "0xclaim",
      });
      expect(mocks.w3sExecuteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          walletId: "wallet-id",
          walletAddress: wallet,
          functionName: "claim",
        }),
      );
    } finally {
      restoreEnv();
    }
  });

  it("keeps wallet-signature-only custodial wallets blocked", async () => {
    const restoreEnv = setCircleEnv();
    mocks.readSources.mockResolvedValue([
      source({
        probation: true,
        ownershipProof: {
          method: "wallet-signature",
          signer: wallet,
          signatureHash: `0x${"ab".repeat(32)}`,
          verifiedAt: "2026-07-07T00:00:00.000Z",
        },
      }),
    ]);

    try {
      const response = await POST(request(), context());
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body.error).toBe(
        "verify or claim source ownership before claiming",
      );
      expect(mocks.readFeeRouterClaimable).not.toHaveBeenCalled();
      expect(mocks.w3sExecuteContract).not.toHaveBeenCalled();
    } finally {
      restoreEnv();
    }
  });
});
