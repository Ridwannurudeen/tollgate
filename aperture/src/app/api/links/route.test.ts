import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkRegistryError } from "../../../lib/link-registry";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  handleLinkRegistration: vi.fn(),
  getSessionOwner: vi.fn(),
  signSession: vi.fn(),
  listPublicLinks: vi.fn(),
}));

vi.mock("../../../lib/link-registration", () => ({
  handleLinkRegistration: mocks.handleLinkRegistration,
}));

vi.mock("../../../lib/account", () => ({
  SESSION_COOKIE_NAME: "aperture_session",
  getSessionOwner: mocks.getSessionOwner,
  signSession: mocks.signSession,
  sessionCookieOptions: () => ({
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/aperture",
    maxAge: 2592000,
  }),
}));

vi.mock("../../../lib/link-registry", () => ({
  LinkRegistryError: class LinkRegistryError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
  listPublicLinks: mocks.listPublicLinks,
}));

function request(ip: string): NextRequest {
  return new NextRequest("http://aperture.test/aperture/api/links", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": ip,
    },
    body: JSON.stringify({
      sourceUrl: "https://photos.example.com/photo.jpg",
      title: "Photo",
      displayName: "Jane Lens",
    }),
  });
}

function requestWithBody(
  ip: string,
  body: Record<string, unknown>,
): NextRequest {
  return new NextRequest("http://aperture.test/aperture/api/links", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-real-ip": ip,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/links", () => {
  const savedPublicOrigin = process.env.APERTURE_PUBLIC_ORIGIN;

  beforeEach(() => {
    process.env.APERTURE_PUBLIC_ORIGIN = "https://tollgate.gudman.xyz";
    mocks.handleLinkRegistration.mockReset();
    mocks.getSessionOwner.mockReset();
    mocks.signSession.mockReset();
    mocks.listPublicLinks.mockReset();
    mocks.getSessionOwner.mockResolvedValue(null);
    mocks.signSession.mockReturnValue("owner-1.signature");
  });

  afterEach(() => {
    if (savedPublicOrigin === undefined) {
      delete process.env.APERTURE_PUBLIC_ORIGIN;
    } else {
      process.env.APERTURE_PUBLIC_ORIGIN = savedPublicOrigin;
    }
  });

  it("rate-limits the eleventh registration per IP", async () => {
    mocks.handleLinkRegistration.mockResolvedValue({
      link: { id: "link-1", title: "Photo", priceAtomicUsdc: 2500 },
      registered: {
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://tollgate.gudman.xyz/aperture/link/link-1",
    });
    const ip = "198.51.100.201";

    for (let index = 0; index < 10; index += 1) {
      const response = await POST(request(ip));
      expect(response.status).toBe(201);
    }
    const blocked = await POST(request(ip));

    expect(blocked.status).toBe(429);
  });

  it("sets a session cookie after first-time account creation", async () => {
    mocks.handleLinkRegistration.mockResolvedValue({
      accountKey: "aptr_key",
      link: { id: "link-1", title: "Photo", priceAtomicUsdc: 2500 },
      registered: {
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://tollgate.gudman.xyz/aperture/link/link-1",
    });

    const response = await POST(request("198.51.100.202"));

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("aperture_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(mocks.signSession).toHaveBeenCalledWith("owner-1");
  });

  it("redacts the public creator response after signing the raw owner session", async () => {
    mocks.handleLinkRegistration.mockResolvedValue({
      accountKey: "aptr_key",
      link: {
        id: "link-private",
        title: "Contact archive@example.com",
        ownerId: "owner-archive@example.com",
        priceAtomicUsdc: 2500,
      },
      registered: {
        ownerId: "owner-archive@example.com",
        displayName: "Archive archive@example.com",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        createdAt: "2026-07-06T00:00:00.000Z",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://tollgate.gudman.xyz/aperture/link/link-private",
    });

    const response = await POST(request("198.51.100.206"));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(JSON.stringify(body)).not.toContain("archive@example.com");
    expect(mocks.signSession).toHaveBeenCalledWith("owner-archive@example.com");
  });

  it("passes an existing session owner into link registration", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "existing-owner",
      displayName: "Existing Lens",
    });
    mocks.handleLinkRegistration.mockResolvedValue({
      link: { id: "link-2", title: "Photo", priceAtomicUsdc: 2500 },
      registered: {
        ownerId: "existing-owner",
        displayName: "Existing Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://tollgate.gudman.xyz/aperture/link/link-2",
    });

    const response = await POST(request("198.51.100.203"));

    expect(response.status).toBe(201);
    expect(mocks.handleLinkRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ email: undefined }),
      expect.objectContaining({ sessionOwnerId: "existing-owner" }),
    );
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not bind a caller-provided email for logged-out registration", async () => {
    mocks.handleLinkRegistration.mockResolvedValue({
      accountKey: "aptr_key",
      link: { id: "link-3", title: "Photo", priceAtomicUsdc: 2500 },
      registered: {
        ownerId: "owner-3",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://tollgate.gudman.xyz/aperture/link/link-3",
    });

    await POST(
      requestWithBody("198.51.100.204", {
        sourceUrl: "https://photos.example.com/photo.jpg",
        title: "Photo",
        displayName: "Jane Lens",
        email: "jane@example.com",
      }),
    );

    expect(mocks.handleLinkRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ email: undefined }),
      expect.not.objectContaining({ sessionOwnerId: expect.any(String) }),
    );
  });

  it("uses the configured public origin instead of request host headers", async () => {
    process.env.APERTURE_PUBLIC_ORIGIN = "https://canonical.example";
    mocks.handleLinkRegistration.mockResolvedValue({
      link: { id: "link-4", title: "Photo", priceAtomicUsdc: 2500 },
      registered: {
        ownerId: "owner-4",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        approvalStatus: "operator-approved",
      },
      shareUrl: "https://canonical.example/aperture/link/link-4",
    });
    const hostileRequest = request("198.51.100.205");
    hostileRequest.headers.set("host", "evil.example");
    hostileRequest.headers.set("x-forwarded-host", "also-evil.example");
    hostileRequest.headers.set("x-forwarded-proto", "http");

    await POST(hostileRequest);

    expect(mocks.handleLinkRegistration).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ origin: "https://canonical.example" }),
    );
  });

  it("does not expose Circle request details in registration errors", async () => {
    mocks.handleLinkRegistration.mockRejectedValue(
      new Error(
        "Circle request /wallets/private-circle-wallet-id failed: upstream-secret-body",
      ),
    );

    const response = await POST(request("198.51.100.207"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "photo link registration failed" });
    expect(JSON.stringify(body)).not.toContain("private-circle-wallet-id");
    expect(JSON.stringify(body)).not.toContain("upstream-secret-body");
  });

  it("preserves LinkRegistryError messages and status codes", async () => {
    mocks.handleLinkRegistration.mockRejectedValue(
      new LinkRegistryError("photo URL already registered.", 409),
    );

    const response = await POST(request("198.51.100.208"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "photo URL already registered.",
    });
  });
});

describe("GET /api/links", () => {
  beforeEach(() => {
    mocks.listPublicLinks.mockReset();
  });

  it("returns public link projections", async () => {
    mocks.listPublicLinks.mockResolvedValue([
      {
        id: "link-1",
        title: "Photo",
        ownerId: "owner-1",
        priceAtomicUsdc: 2500,
      },
    ]);

    const response = await GET();
    const body = (await response.json()) as {
      links: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(body.links[0].id).toBe("link-1");
    expect(body.links[0].sourceUrl).toBeUndefined();
  });
});
