import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  assertWordPressRegistrationRateLimit: vi.fn(),
  registerWordPressSite: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  assertWordPressRegistrationRateLimit:
    mocks.assertWordPressRegistrationRateLimit,
}));

vi.mock("@/lib/wordpress", () => {
  class WordPressRegistryError extends Error {
    constructor(
      message: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  }
  return {
    WordPressRegistryError,
    registerWordPressSite: mocks.registerWordPressSite,
  };
});

function request(body: unknown, ip = "198.51.100.10"): NextRequest {
  return new NextRequest("http://tollgate.test/api/wordpress/sites/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/wordpress/sites/register", () => {
  beforeEach(() => {
    mocks.assertWordPressRegistrationRateLimit.mockReset();
    mocks.registerWordPressSite.mockReset();
  });

  it("registers a site and returns the one-time API key", async () => {
    mocks.registerWordPressSite.mockResolvedValue({
      site: {
        id: "wp_site",
        siteUrl: "https://publisher.example/",
        creatorWallet: "0x7777777777777777777777777777777777777777",
        registeredAt: "2026-07-07T00:00:00.000Z",
      },
      apiKey: "tgwp_key",
    });

    const response = await POST(
      request({
        siteUrl: "https://publisher.example",
        creatorWallet: "0x7777777777777777777777777777777777777777",
        apiKeySeed: "operator-seed",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.assertWordPressRegistrationRateLimit).toHaveBeenCalledWith(
      "198.51.100.10",
    );
    expect(body.apiKey).toBe("tgwp_key");
    expect(JSON.stringify(body)).not.toContain("apiKeyHash");
  });

  it("returns 429 when the registration bucket is exhausted", async () => {
    mocks.assertWordPressRegistrationRateLimit.mockImplementation(() => {
      throw new Error("Too many WordPress site registrations.");
    });

    const response = await POST(request({}));
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too many WordPress site registrations.");
    expect(mocks.registerWordPressSite).not.toHaveBeenCalled();
  });
});
