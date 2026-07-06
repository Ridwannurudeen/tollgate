import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  evaluateLicenseCheck: vi.fn(),
}));

vi.mock("../../../lib/license-check", () => ({
  evaluateLicenseCheck: mocks.evaluateLicenseCheck,
}));

function request(originalUri: string): Request {
  return new Request("http://aperture.test/aperture/api/license-check", {
    headers: {
      "x-original-method": "POST",
      "x-original-uri": originalUri,
    },
  });
}

describe("GET /api/license-check", () => {
  it("returns 204 when the license check allows the archive request", async () => {
    mocks.evaluateLicenseCheck.mockResolvedValueOnce({
      allowed: true,
      status: 204,
    });

    const response = await GET(
      request("/immich/api/download/archive?key=abc123"),
    );

    expect(response.status).toBe(204);
    expect(mocks.evaluateLicenseCheck).toHaveBeenCalledWith(
      {
        originalMethod: "POST",
        originalUri: "/immich/api/download/archive?key=abc123",
      },
      expect.any(Object),
    );
  });

  it("returns 403 JSON when the license check denies the archive request", async () => {
    mocks.evaluateLicenseCheck.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      body: {
        error: "payment required",
        pay: "/aperture/api/license-download",
      },
    });

    const response = await GET(
      request("/immich/api/download/archive?key=abc123"),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "payment required",
      pay: "/aperture/api/license-download",
    });
  });
});
