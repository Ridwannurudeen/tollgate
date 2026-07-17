import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  evaluateLicenseCheck: vi.fn(),
}));

vi.mock("../../../lib/license-check", () => ({
  evaluateLicenseCheck: mocks.evaluateLicenseCheck,
}));

function request(
  originalUri: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://aperture.test/aperture/api/license-check", {
    headers: {
      "x-original-method": "POST",
      "x-original-uri": originalUri,
      ...headers,
    },
  });
}

describe("GET /api/license-check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 204 when the license check allows the archive request", async () => {
    mocks.evaluateLicenseCheck.mockResolvedValueOnce({
      allowed: true,
      status: 204,
    });

    const response = await GET(
      request("/immich/api/download/archive?key=abc123"),
    );

    expect(response.status).toBe(204);
    expect(mocks.evaluateLicenseCheck).toHaveBeenCalledWith({
      originalMethod: "POST",
      originalUri: "/immich/api/download/archive?key=abc123",
      originalImmichShareKey: null,
      originalImmichShareSlug: null,
    });
  });

  it("forwards original Immich shared-link headers to the boundary check", async () => {
    mocks.evaluateLicenseCheck.mockResolvedValueOnce({
      allowed: false,
      status: 403,
      body: {
        error: "payment required",
        pay: "/aperture/api/license-download",
      },
    });

    await GET(
      request("/immich/api/download/archive", {
        "x-original-immich-share-key": "abc123",
        "x-original-immich-share-slug": "public-share",
      }),
    );

    expect(mocks.evaluateLicenseCheck).toHaveBeenCalledWith({
      originalMethod: "POST",
      originalUri: "/immich/api/download/archive",
      originalImmichShareKey: "abc123",
      originalImmichShareSlug: "public-share",
    });
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
