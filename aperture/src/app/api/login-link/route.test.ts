import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  findOwnerByEmail: vi.fn(),
  generateLoginToken: vi.fn(),
  generateSignupToken: vi.fn(),
  sendLoginLinkEmail: vi.fn(),
  sendSignupLinkEmail: vi.fn(),
}));

vi.mock("../../../lib/account", () => ({
  findOwnerByEmail: mocks.findOwnerByEmail,
  generateLoginToken: mocks.generateLoginToken,
  generateSignupToken: mocks.generateSignupToken,
  normalizeAccountEmail: (value: string) => {
    const trimmed = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
  },
}));

vi.mock("../../../lib/mailer", () => ({
  sendLoginLinkEmail: mocks.sendLoginLinkEmail,
  sendSignupLinkEmail: mocks.sendSignupLinkEmail,
}));

function request(
  ip: string,
  email: string,
  host = "tollgate.gudman.xyz",
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new NextRequest(
    "https://tollgate.gudman.xyz/aperture/api/login-link",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host,
        "x-real-ip": ip,
        ...extraHeaders,
      },
      body: JSON.stringify({ email }),
    },
  );
}

describe("POST /api/login-link", () => {
  const savedPublicOrigin = process.env.APERTURE_PUBLIC_ORIGIN;

  beforeEach(() => {
    process.env.APERTURE_PUBLIC_ORIGIN = "https://tollgate.gudman.xyz";
    mocks.findOwnerByEmail.mockReset();
    mocks.generateLoginToken.mockReset();
    mocks.generateSignupToken.mockReset();
    mocks.sendLoginLinkEmail.mockReset();
    mocks.sendSignupLinkEmail.mockReset();
    mocks.sendLoginLinkEmail.mockResolvedValue(true);
    mocks.sendSignupLinkEmail.mockResolvedValue(true);
  });

  afterEach(() => {
    if (savedPublicOrigin === undefined) {
      delete process.env.APERTURE_PUBLIC_ORIGIN;
    } else {
      process.env.APERTURE_PUBLIC_ORIGIN = savedPublicOrigin;
    }
  });

  it("returns the same success response and sends a signup link for unknown emails", async () => {
    mocks.findOwnerByEmail.mockResolvedValue(null);
    mocks.generateSignupToken.mockReturnValue("signup-token.signature");

    const response = await POST(request("198.51.100.231", "jane@example.com"));
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.generateLoginToken).not.toHaveBeenCalled();
    expect(mocks.sendLoginLinkEmail).not.toHaveBeenCalled();
    expect(mocks.generateSignupToken).toHaveBeenCalledWith("jane@example.com");
    expect(mocks.sendSignupLinkEmail).toHaveBeenCalledWith(
      "jane@example.com",
      "https://tollgate.gudman.xyz/aperture/login/verify/signup-token.signature",
    );
  });

  it("sends a single-use login link for known emails", async () => {
    mocks.findOwnerByEmail.mockResolvedValue({
      ownerId: "owner-1",
      email: "jane@example.com",
    });
    mocks.generateLoginToken.mockResolvedValue({
      token: "a".repeat(64),
      hash: `0x${"b".repeat(64)}`,
      expiresAt: "2026-07-06T00:20:00.000Z",
    });

    const response = await POST(
      request("198.51.100.232", " Jane@Example.COM "),
    );

    expect(response.status).toBe(200);
    expect(mocks.findOwnerByEmail).toHaveBeenCalledWith("jane@example.com");
    expect(mocks.generateLoginToken).toHaveBeenCalledWith("owner-1");
    expect(mocks.sendLoginLinkEmail).toHaveBeenCalledWith(
      "jane@example.com",
      "https://tollgate.gudman.xyz/aperture/login/verify/" + "a".repeat(64),
    );
    expect(mocks.generateSignupToken).not.toHaveBeenCalled();
    expect(mocks.sendSignupLinkEmail).not.toHaveBeenCalled();
  });

  it("uses the configured canonical origin for untrusted host headers", async () => {
    process.env.APERTURE_PUBLIC_ORIGIN = "https://canonical.example";
    mocks.findOwnerByEmail.mockResolvedValue({
      ownerId: "owner-1",
      email: "jane@example.com",
    });
    mocks.generateLoginToken.mockResolvedValue({
      token: "c".repeat(64),
      hash: `0x${"d".repeat(64)}`,
      expiresAt: "2026-07-06T00:20:00.000Z",
    });

    await POST(
      request("198.51.100.233", "jane@example.com", "evil.test", {
        "x-forwarded-host": "also-evil.test",
        "x-forwarded-proto": "http",
      }),
    );

    expect(mocks.sendLoginLinkEmail).toHaveBeenCalledWith(
      "jane@example.com",
      "https://canonical.example/aperture/login/verify/" + "c".repeat(64),
    );
  });

  it("rate-limits login-link requests per IP", async () => {
    mocks.findOwnerByEmail.mockResolvedValue(null);
    mocks.generateSignupToken.mockReturnValue("signup-token.signature");
    const ip = "198.51.100.234";

    for (let index = 0; index < 5; index += 1) {
      const response = await POST(request(ip, `jane${index}@example.com`));
      expect(response.status).toBe(200);
    }
    const blocked = await POST(request(ip, "final@example.com"));

    expect(blocked.status).toBe(429);
  });
});
