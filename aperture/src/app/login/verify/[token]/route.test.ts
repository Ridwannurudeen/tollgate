import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  findOwnerByEmail: vi.fn(),
  redeemLoginToken: vi.fn(),
  registerCreator: vi.fn(),
  signSession: vi.fn(),
  verifySignupToken: vi.fn(),
}));

vi.mock("../../../../lib/account", () => ({
  SESSION_COOKIE_NAME: "aperture_session",
  findOwnerByEmail: mocks.findOwnerByEmail,
  redeemLoginToken: mocks.redeemLoginToken,
  sessionCookieOptions: () => ({
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/aperture",
    maxAge: 2592000,
  }),
  signSession: mocks.signSession,
  verifySignupToken: mocks.verifySignupToken,
}));

vi.mock("../../../../lib/onboarding", () => ({
  registerCreator: mocks.registerCreator,
}));

function request(token = "a".repeat(64)): NextRequest {
  return new NextRequest(
    `https://tollgate.gudman.xyz/aperture/login/verify/${token}`,
  );
}

describe("GET /login/verify/[token]", () => {
  const savedSecret = process.env.APERTURE_SESSION_SECRET;
  const savedBasePath = process.env.APERTURE_BASE_PATH;
  const savedPublicOrigin = process.env.APERTURE_PUBLIC_ORIGIN;

  beforeEach(() => {
    process.env.APERTURE_SESSION_SECRET = "session-secret";
    process.env.APERTURE_BASE_PATH = "/aperture";
    process.env.APERTURE_PUBLIC_ORIGIN = "https://tollgate.gudman.xyz";
    mocks.findOwnerByEmail.mockReset();
    mocks.redeemLoginToken.mockReset();
    mocks.registerCreator.mockReset();
    mocks.signSession.mockReset();
    mocks.verifySignupToken.mockReset();
    mocks.verifySignupToken.mockReturnValue(null);
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
    if (savedPublicOrigin === undefined) {
      delete process.env.APERTURE_PUBLIC_ORIGIN;
    } else {
      process.env.APERTURE_PUBLIC_ORIGIN = savedPublicOrigin;
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
    expect(mocks.verifySignupToken).not.toHaveBeenCalled();
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
    expect(mocks.verifySignupToken).toHaveBeenCalledWith("bad");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("creates and logs in a new account for a valid signup token", async () => {
    mocks.redeemLoginToken.mockResolvedValue(null);
    mocks.verifySignupToken.mockReturnValue("jane@example.com");
    mocks.findOwnerByEmail.mockResolvedValue(null);
    mocks.registerCreator.mockResolvedValue({
      ownerId: "link-new",
      displayName: "jane",
      email: "jane@example.com",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
    });
    mocks.signSession.mockReturnValue("link-new.signature");

    const response = await GET(request("signup.payload"), {
      params: Promise.resolve({ token: "signup.payload" }),
    });
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://tollgate.gudman.xyz/aperture/dashboard",
    );
    expect(mocks.registerCreator).toHaveBeenCalledWith({
      ownerId: expect.stringMatching(/^link-/),
      displayName: "jane",
      email: "jane@example.com",
    });
    expect(mocks.signSession).toHaveBeenCalledWith("link-new");
    expect(cookie).toContain("aperture_session=link-new.signature");
  });

  it("rejects a signup token once its email belongs to an existing account", async () => {
    mocks.redeemLoginToken.mockResolvedValue(null);
    mocks.verifySignupToken.mockReturnValue("jane@example.com");
    mocks.findOwnerByEmail.mockResolvedValue({
      ownerId: "owner-existing",
      displayName: "Jane Lens",
      email: "jane@example.com",
    });
    mocks.signSession.mockReturnValue("owner-existing.signature");

    const response = await GET(request("signup.payload"), {
      params: Promise.resolve({ token: "signup.payload" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.registerCreator).not.toHaveBeenCalled();
    expect(mocks.signSession).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("redirects only to the configured public origin", async () => {
    process.env.APERTURE_PUBLIC_ORIGIN = "https://canonical.example";
    mocks.redeemLoginToken.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
    });
    mocks.signSession.mockReturnValue("owner-1.signature");
    const hostileRequest = new NextRequest(
      "https://tollgate.gudman.xyz/aperture/login/verify/token",
      {
        headers: {
          host: "evil.example",
          "x-forwarded-host": "also-evil.example",
          "x-forwarded-proto": "http",
        },
      },
    );

    const response = await GET(hostileRequest, {
      params: Promise.resolve({ token: "a".repeat(64) }),
    });

    expect(response.headers.get("location")).toBe(
      "https://canonical.example/aperture/dashboard",
    );
  });

  it("returns a creation error page if signup account creation fails", async () => {
    mocks.redeemLoginToken.mockResolvedValue(null);
    mocks.verifySignupToken.mockReturnValue("jane@example.com");
    mocks.findOwnerByEmail.mockResolvedValue(null);
    mocks.registerCreator.mockRejectedValue(new Error("circle offline"));

    const response = await GET(request("signup.payload"), {
      params: Promise.resolve({ token: "signup.payload" }),
    });
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(html).toContain("Couldn't create your account.");
    expect(mocks.signSession).not.toHaveBeenCalled();
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
