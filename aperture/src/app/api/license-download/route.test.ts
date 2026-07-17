import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  assertLicenseDownloadRateLimit: vi.fn(),
  handleLicenseDownload: vi.fn(),
}));

vi.mock("../../../lib/link-rate-limit", () => ({
  assertLicenseDownloadRateLimit: mocks.assertLicenseDownloadRateLimit,
}));

vi.mock("../../../lib/license-download", () => ({
  MAX_LICENSE_ASSET_IDS: 100,
  handleLicenseDownload: mocks.handleLicenseDownload,
}));

function request(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(
    "https://tollgate.gudman.xyz/aperture/api/license-download",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "198.51.100.220",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/license-download", () => {
  const savedPublicOrigin = process.env.APERTURE_PUBLIC_ORIGIN;

  beforeEach(() => {
    process.env.APERTURE_PUBLIC_ORIGIN = "https://canonical.example";
    mocks.assertLicenseDownloadRateLimit.mockReset();
    mocks.handleLicenseDownload.mockReset();
    mocks.handleLicenseDownload.mockResolvedValue({
      status: 402,
      headers: {},
      body: { error: "payment required" },
    });
  });

  afterEach(() => {
    if (savedPublicOrigin === undefined) {
      delete process.env.APERTURE_PUBLIC_ORIGIN;
    } else {
      process.env.APERTURE_PUBLIC_ORIGIN = savedPublicOrigin;
    }
  });

  it("rejects oversized asset lists before downstream work", async () => {
    const response = await POST(
      request({
        sharedLinkKey: "share-1",
        assetIds: Array.from({ length: 101 }, (_, index) => `asset-${index}`),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.handleLicenseDownload).not.toHaveBeenCalled();
  });

  it("rate-limits before downstream work", async () => {
    mocks.assertLicenseDownloadRateLimit.mockImplementation(() => {
      throw new Error("Too many license-download requests. Wait a minute.");
    });

    const response = await POST(request({ sharedLinkKey: "share-1" }));

    expect(response.status).toBe(429);
    expect(mocks.handleLicenseDownload).not.toHaveBeenCalled();
  });

  it("uses the configured public origin instead of request host headers", async () => {
    await POST(
      request(
        { sharedLinkKey: "share-1" },
        {
          host: "evil.example",
          "x-forwarded-host": "also-evil.example",
          "x-forwarded-proto": "http",
        },
      ),
    );

    expect(mocks.handleLicenseDownload).toHaveBeenCalledWith(
      { sharedLinkKey: "share-1" },
      expect.objectContaining({ origin: "https://canonical.example" }),
    );
  });
});
