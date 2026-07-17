import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  assertLicenseDownloadRateLimit: vi.fn(),
  handleLinkDownload: vi.fn(),
}));

vi.mock("../../../../../lib/link-rate-limit", () => ({
  assertLicenseDownloadRateLimit: mocks.assertLicenseDownloadRateLimit,
}));

vi.mock("../../../../../lib/link-download", () => ({
  handleLinkDownload: mocks.handleLinkDownload,
}));

vi.mock("../../../../../lib/fee-router", () => ({
  routeLicensePayment: vi.fn(),
}));

vi.mock("../../../../../lib/ledger", () => ({
  appendLicenseReceipt: vi.fn(),
}));

vi.mock("../../../../../lib/public-origin", () => ({
  aperturePublicOrigin: () => "https://aperture.test",
}));

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "https://aperture.test/aperture/api/links/link-1/download",
    { method: "POST", headers },
  );
}

describe("POST /api/links/[id]/download", () => {
  beforeEach(() => {
    mocks.assertLicenseDownloadRateLimit.mockReset();
    mocks.handleLinkDownload.mockReset();
    mocks.handleLinkDownload.mockResolvedValue({
      status: 200,
      headers: {},
      body: { ok: true },
    });
  });

  it("returns 429 without invoking the link handler when the request is rate-limited", async () => {
    mocks.assertLicenseDownloadRateLimit.mockImplementation(() => {
      throw new Error("Too many license-download requests. Wait a minute.");
    });

    const response = await POST(
      request({ "x-real-ip": "198.51.100.230" }),
      { params: Promise.resolve({ id: "link-1" }) },
    );

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: "Too many license-download requests. Wait a minute.",
    });
    expect(mocks.assertLicenseDownloadRateLimit).toHaveBeenCalledWith(
      "198.51.100.230",
    );
    expect(mocks.handleLinkDownload).not.toHaveBeenCalled();
  });

  it("always sends x402 directly to the approved photographer", async () => {
    const previousCollector = process.env.APERTURE_LICENSE_COLLECTOR_ADDRESS;
    process.env.APERTURE_LICENSE_COLLECTOR_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    try {
      await POST(request(), {
        params: Promise.resolve({ id: "link-1" }),
      });
    } finally {
      if (previousCollector === undefined) {
        delete process.env.APERTURE_LICENSE_COLLECTOR_ADDRESS;
      } else {
        process.env.APERTURE_LICENSE_COLLECTOR_ADDRESS = previousCollector;
      }
    }

    expect(mocks.handleLinkDownload).toHaveBeenCalledTimes(1);
    expect(mocks.handleLinkDownload.mock.calls[0][1]).not.toHaveProperty(
      "collectorAddress",
    );
    expect(mocks.handleLinkDownload.mock.calls[0][1]).not.toHaveProperty(
      "routeLicensePayment",
    );
  });
});
