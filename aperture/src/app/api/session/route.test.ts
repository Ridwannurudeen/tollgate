import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "./route";

const mocks = vi.hoisted(() => ({
  findOwnerByAccountKey: vi.fn(),
  signSession: vi.fn(),
}));

vi.mock("../../../lib/account", () => ({
  SESSION_COOKIE_NAME: "aperture_session",
  findOwnerByAccountKey: mocks.findOwnerByAccountKey,
  signSession: mocks.signSession,
  sessionCookieOptions: (maxAge = 2592000) => ({
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/aperture",
    maxAge,
  }),
}));

function request(ip: string, accountKey = "aptr_key"): NextRequest {
  return new NextRequest("http://aperture.test/aperture/api/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": ip,
    },
    body: JSON.stringify({ accountKey }),
  });
}

describe("POST /api/session", () => {
  beforeEach(() => {
    mocks.findOwnerByAccountKey.mockReset();
    mocks.signSession.mockReset();
    mocks.findOwnerByAccountKey.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
    });
    mocks.signSession.mockReturnValue("owner-1.signature");
  });

  it("sets an HttpOnly session cookie for a valid account key", async () => {
    const response = await POST(request("198.51.100.211"));
    const body = (await response.json()) as { ok: boolean };
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.findOwnerByAccountKey).toHaveBeenCalledWith("aptr_key");
    expect(cookie).toContain("aperture_session=owner-1.signature");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Path=/aperture");
  });

  it("returns 401 for an unknown account key", async () => {
    mocks.findOwnerByAccountKey.mockResolvedValueOnce(null);

    const response = await POST(request("198.51.100.212"));

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 503 when the session secret is not configured", async () => {
    mocks.signSession.mockReturnValueOnce(null);

    const response = await POST(request("198.51.100.213"));

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rate-limits login attempts per IP", async () => {
    mocks.findOwnerByAccountKey.mockResolvedValue(null);
    const ip = "198.51.100.214";

    for (let index = 0; index < 10; index += 1) {
      const response = await POST(request(ip, `aptr_bad_${index}`));
      expect(response.status).toBe(401);
    }
    const blocked = await POST(request(ip, "aptr_bad_final"));

    expect(blocked.status).toBe(429);
  });
});

describe("DELETE /api/session", () => {
  it("clears the session cookie", async () => {
    const response = await DELETE();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(cookie).toContain("aperture_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Path=/aperture");
  });
});
