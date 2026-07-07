import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  assertWithdrawRateLimit: vi.fn(),
  readCustodialUsdcBalance: vi.fn(),
  withdrawCustodialUsdc: vi.fn(),
}));

vi.mock("../../../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
}));

vi.mock("../../../../lib/link-rate-limit", () => ({
  assertWithdrawRateLimit: mocks.assertWithdrawRateLimit,
}));

vi.mock("../../../../lib/withdraw", () => ({
  readCustodialUsdcBalance: mocks.readCustodialUsdcBalance,
  withdrawCustodialUsdc: mocks.withdrawCustodialUsdc,
}));

const wallet = "0x1111111111111111111111111111111111111111";
const destination = "0x2222222222222222222222222222222222222222";

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://aperture.test/aperture/api/account/withdraw", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": "198.51.100.40",
    },
    body: JSON.stringify(body),
  });
}

function custodialOwner(overrides: Record<string, unknown> = {}) {
  return {
    ownerId: "owner-1",
    displayName: "Jane Lens",
    wallet,
    walletId: "circle-wallet-id",
    custody: "circle-w3s",
    approvalStatus: "operator-approved",
    createdAt: "2026-07-07T00:00:00.000Z",
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

describe("/api/account/withdraw", () => {
  beforeEach(() => {
    mocks.getSessionOwner.mockReset();
    mocks.assertWithdrawRateLimit.mockReset();
    mocks.readCustodialUsdcBalance.mockReset();
    mocks.withdrawCustodialUsdc.mockReset();
    mocks.getSessionOwner.mockResolvedValue(custodialOwner());
    mocks.readCustodialUsdcBalance.mockResolvedValue(2500n);
    mocks.withdrawCustodialUsdc.mockResolvedValue("0xwithdraw");
  });

  it("requires a logged-in owner", async () => {
    mocks.getSessionOwner.mockResolvedValue(null);

    const response = await POST(
      request({ toAddress: destination, amountAtomicUsdc: "2500" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.withdrawCustodialUsdc).not.toHaveBeenCalled();
  });

  it("returns the live custodial balance for the session owner", async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ wallet, balanceAtomicUsdc: "2500" });
    expect(mocks.readCustodialUsdcBalance).toHaveBeenCalledWith(wallet);
  });

  it("rejects self-custody accounts", async () => {
    mocks.getSessionOwner.mockResolvedValue(
      custodialOwner({ custody: "self", walletId: undefined }),
    );

    const response = await POST(
      request({ toAddress: destination, amountAtomicUsdc: "2500" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.withdrawCustodialUsdc).not.toHaveBeenCalled();
  });

  it("rejects malformed destinations, self-transfer, zero address, and bad amounts", async () => {
    await expect(POST(request({ toAddress: "bad", amountAtomicUsdc: "1" })))
      .resolves.toHaveProperty("status", 400);
    await expect(POST(request({ toAddress: wallet, amountAtomicUsdc: "1" })))
      .resolves.toHaveProperty("status", 400);
    await expect(
      POST(
        request({
          toAddress: "0x0000000000000000000000000000000000000000",
          amountAtomicUsdc: "1",
        }),
      ),
    ).resolves.toHaveProperty("status", 400);
    await expect(
      POST(request({ toAddress: destination, amountAtomicUsdc: "1.5" })),
    ).resolves.toHaveProperty("status", 400);
    expect(mocks.withdrawCustodialUsdc).not.toHaveBeenCalled();
  });

  it("rate-limits withdraw attempts", async () => {
    mocks.assertWithdrawRateLimit.mockImplementation(() => {
      throw new Error("Too many withdraw attempts. Wait an hour and retry.");
    });

    const response = await POST(
      request({ toAddress: destination, amountAtomicUsdc: "2500" }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toMatch(/Too many withdraw/);
    expect(mocks.withdrawCustodialUsdc).not.toHaveBeenCalled();
  });

  it("withdraws from the session owner's custodial wallet only", async () => {
    const restoreEnv = setCircleEnv();
    try {
      const response = await POST(
        request({
          toAddress: destination,
          amountAtomicUsdc: "2500",
          walletId: "attacker-wallet-id",
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.transaction).toBe("0xwithdraw");
      expect(mocks.withdrawCustodialUsdc).toHaveBeenCalledWith({
        walletId: "circle-wallet-id",
        walletAddress: wallet,
        toAddress: destination,
        amountAtomicUsdc: 2500n,
      });
    } finally {
      restoreEnv();
    }
  });
});
