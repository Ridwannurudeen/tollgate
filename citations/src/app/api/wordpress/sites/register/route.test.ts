import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  assertWordPressRegistrationRateLimit: vi.fn(),
  authorizeWordPressRegistration: vi.fn(),
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
    authorizeWordPressRegistration: mocks.authorizeWordPressRegistration,
    registerWordPressSite: mocks.registerWordPressSite,
  };
});

function request(
  body: unknown,
  ip = "198.51.100.10",
  registrationSecret?: string,
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip,
  };
  if (registrationSecret) {
    headers["x-tollgate-registration-secret"] = registrationSecret;
  }
  return new NextRequest("http://tollgate.test/api/wordpress/sites/register", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/wordpress/sites/register", () => {
  beforeEach(() => {
    mocks.assertWordPressRegistrationRateLimit.mockReset();
    mocks.authorizeWordPressRegistration.mockReset();
    mocks.registerWordPressSite.mockReset();
  });

  it("rejects public registration without an operator-issued capability", async () => {
    mocks.authorizeWordPressRegistration.mockReturnValue(false);

    const response = await POST(request({}));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("invalid registration capability");
    expect(mocks.authorizeWordPressRegistration).toHaveBeenCalledWith(null);
    expect(mocks.assertWordPressRegistrationRateLimit).toHaveBeenCalledWith(
      "198.51.100.10",
    );
    expect(mocks.registerWordPressSite).not.toHaveBeenCalled();
  });

  it("registers a site and returns the one-time API key", async () => {
    mocks.authorizeWordPressRegistration.mockReturnValue(true);
    mocks.registerWordPressSite.mockResolvedValue({
      site: {
        id: "wp_site",
        siteUrl: "https://publisher.example/",
        creatorWallet: "0x7777777777777777777777777777777777777777",
        priceAtomicUsdc: 2500,
        registeredAt: "2026-07-07T00:00:00.000Z",
      },
      apiKey: "tgwp_key",
    });

    const response = await POST(
      request(
        {
          siteUrl: "https://publisher.example",
          creatorWallet: "0x7777777777777777777777777777777777777777",
          apiKeySeed: "operator-seed",
          priceAtomicUsdc: 2500,
        },
        "198.51.100.10",
        "registration-capability",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.authorizeWordPressRegistration).toHaveBeenCalledWith(
      "registration-capability",
    );
    expect(mocks.assertWordPressRegistrationRateLimit).toHaveBeenCalledWith(
      "198.51.100.10",
    );
    expect(body.apiKey).toBe("tgwp_key");
    expect(JSON.stringify(body)).not.toContain("apiKeyHash");
  });

  it("returns 429 when the registration bucket is exhausted", async () => {
    mocks.authorizeWordPressRegistration.mockReturnValue(true);
    mocks.assertWordPressRegistrationRateLimit.mockImplementation(() => {
      throw new Error("Too many WordPress site registrations.");
    });

    const response = await POST(
      request({}, "198.51.100.10", "registration-capability"),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too many WordPress site registrations.");
    expect(mocks.registerWordPressSite).not.toHaveBeenCalled();
  });
});
