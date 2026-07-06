import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  redeemLoginToken: vi.fn(),
  signSession: vi.fn(),
}));

vi.mock("../../../../lib/account", () => ({
  SESSION_COOKIE_NAME: "aperture_session",
  redeemLoginToken: mocks.redeemLoginToken,
  sessionCookieOptions: () => ({
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/aperture",
    maxAge: 2592000,
  }),
  signSession: mocks.signSession,
}));

function request(token = "a".repeat(64)): NextRequest {
  return new NextRequest(
    `https://tollgate.gudman.xyz/aperture/login/verify/${token}`,
  );
}

describe("GET /login/verify/[token]", () => {
  const savedSecret = process.env.APERTURE_SESSION_SECRET;
  const savedBasePath = process.env.APERTURE_BASE_PATH;

  beforeEach(() => {
    process.env.APERTURE_SESSION_SECRET = "session-secret";
    process.env.APERTURE_BASE_PATH = "/aperture";
    mocks.redeemLoginToken.mockReset();
    mocks.signSession.mockReset();
  });

  afterEach(() => {
    if (savedSecret === undefined) {
      delete process.env.APERTURE_SESSION_SECRET;
    } else {
      process.env.APERTURE_SESSION_SECRET = savedSecret;
    }
    if (savedBasePath === undefined) {
      delete process.env.APERTURE_BASE_PATH;
    } else {
      process.env.APERTURE_BASE_PATH = savedBasePath;
    }
  });

  it("sets a session cookie and redirects to the dashboard for a valid token", async () => {
    mocks.redeemLoginToken.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
    });
    mocks.signSession.mockReturnValue("owner-1.signature");

    const response = await GET(request(), {
      params: Promise.resolve({ token: "a".repeat(64) }),
    });
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://tollgate.gudman.xyz/aperture/dashboard",
    );
    expect(mocks.redeemLoginToken).toHaveBeenCalledWith("a".repeat(64));
    expect(mocks.signSession).toHaveBeenCalledWith("owner-1");
    expect(cookie).toContain("aperture_session=owner-1.signature");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("returns an invalid-link page for expired or unknown tokens", async () => {
    mocks.redeemLoginToken.mockResolvedValue(null);

    const response = await GET(request("bad"), {
      params: Promise.resolve({ token: "bad" }),
    });
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("Login link invalid or expired.");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("links expired tokens back to the configured base path", async () => {
    process.env.APERTURE_BASE_PATH = "/custom";
    mocks.redeemLoginToken.mockResolvedValue(null);

    const response = await GET(request("bad"), {
      params: Promise.resolve({ token: "bad" }),
    });
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain('href="/custom/login"');
    expect(html).not.toContain('href="/aperture/login"');
  });

  it("fails closed when the session secret is missing", async () => {
    delete process.env.APERTURE_SESSION_SECRET;

    const response = await GET(request(), {
      params: Promise.resolve({ token: "a".repeat(64) }),
    });

    expect(response.status).toBe(503);
    expect(mocks.redeemLoginToken).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
