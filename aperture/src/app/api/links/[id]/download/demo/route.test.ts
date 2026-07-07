import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  payerWalletId: vi.fn(),
  payerAddress: vi.fn(),
  assertDemoUnlockWithinLimits: vi.fn(),
  recordDemoUnlock: vi.fn(),
  createFeeRouterPublicClient: vi.fn(),
  readContract: vi.fn(),
  createW3SPaidFetch: vi.fn(),
  paidFetch: vi.fn(),
}));

vi.mock("../../../../../../lib/circle-w3s", () => ({
  payerWalletId: mocks.payerWalletId,
  payerAddress: mocks.payerAddress,
}));

vi.mock("../../../../../../lib/link-rate-limit", () => ({
  assertDemoUnlockWithinLimits: mocks.assertDemoUnlockWithinLimits,
  recordDemoUnlock: mocks.recordDemoUnlock,
}));

vi.mock("../../../../../../lib/fee-router", () => ({
  createFeeRouterPublicClient: mocks.createFeeRouterPublicClient,
  usdcRouterAbi: [],
}));

vi.mock("../../../../../../lib/x402-custodial", () => ({
  createW3SPaidFetch: mocks.createW3SPaidFetch,
}));

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "http://aperture.test/aperture/api/links/link-1/download/demo",
    { method: "POST", headers },
  );
}

function context(id = "link-1") {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/links/[id]/download/demo", () => {
  beforeEach(() => {
    mocks.payerWalletId.mockReset();
    mocks.payerAddress.mockReset();
    mocks.assertDemoUnlockWithinLimits.mockReset();
    mocks.recordDemoUnlock.mockReset();
    mocks.createFeeRouterPublicClient.mockReset();
    mocks.readContract.mockReset();
    mocks.createW3SPaidFetch.mockReset();
    mocks.paidFetch.mockReset();

    mocks.payerWalletId.mockReturnValue("wallet-1");
    mocks.payerAddress.mockReturnValue(
      "0x1111111111111111111111111111111111111111",
    );
    mocks.createFeeRouterPublicClient.mockReturnValue({
      readContract: mocks.readContract,
    });
    mocks.readContract.mockResolvedValue(2500n);
    mocks.createW3SPaidFetch.mockReturnValue(mocks.paidFetch);
    mocks.paidFetch.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-disposition": 'attachment; filename="photo.jpg"',
          "x-aperture-receipt-hash": `0x${"1".repeat(64)}`,
        },
      }),
    );
  });

  it("returns a plain 503 when the custodial payer is not configured", async () => {
    mocks.payerWalletId.mockImplementation(() => {
      throw new Error("missing");
    });

    const response = await POST(request(), context());
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(body.error).toContain("isn't configured");
    expect(mocks.assertDemoUnlockWithinLimits).not.toHaveBeenCalled();
    expect(mocks.recordDemoUnlock).not.toHaveBeenCalled();
  });

  it("does not record quota when the server-to-server payment fails", async () => {
    mocks.paidFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "raw settlement failure" }), {
        status: 402,
        headers: { "content-type": "application/json" },
      }),
    );

    const response = await POST(
      request({ "x-forwarded-for": "198.51.100.1, 203.0.113.5" }),
      context(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).not.toContain("raw settlement");
    expect(mocks.assertDemoUnlockWithinLimits).toHaveBeenCalledWith(
      "203.0.113.5",
    );
    expect(mocks.recordDemoUnlock).not.toHaveBeenCalled();
  });

  it("streams the photo and records quota only after a successful unlock", async () => {
    const response = await POST(request({ "x-real-ip": "198.51.100.9" }), {
      params: Promise.resolve({ id: "link 1" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="photo.jpg"',
    );
    expect(mocks.paidFetch).toHaveBeenCalledWith(
      "http://aperture.test/aperture/api/links/link%201/download",
      { method: "POST" },
    );
    expect(mocks.recordDemoUnlock).toHaveBeenCalledWith("198.51.100.9");
  });

  it("passes through video response headers after a successful unlock", async () => {
    mocks.paidFetch.mockResolvedValueOnce(
      new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: {
          "content-type": "video/mp4",
          "content-disposition": 'attachment; filename="clip.mp4"',
          "x-aperture-receipt-hash": `0x${"2".repeat(64)}`,
        },
      }),
    );

    const response = await POST(request({ "x-real-ip": "198.51.100.10" }), {
      params: Promise.resolve({ id: "video-1" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Array.from(bytes)).toEqual([9, 8, 7]);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="clip.mp4"',
    );
    expect(response.headers.get("x-aperture-receipt-hash")).toBe(
      `0x${"2".repeat(64)}`,
    );
    expect(mocks.recordDemoUnlock).toHaveBeenCalledWith("198.51.100.10");
  });
});
