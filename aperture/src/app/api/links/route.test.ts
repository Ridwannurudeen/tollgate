import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("POST /api/links", () => {
  beforeEach(() => {
    mocks.handleLinkRegistration.mockReset();
    mocks.getSessionOwner.mockReset();
    mocks.signSession.mockReset();
    mocks.listPublicLinks.mockReset();
    mocks.getSessionOwner.mockResolvedValue(null);
    mocks.signSession.mockReturnValue("owner-1.signature");
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
      expect.any(Object),
      expect.objectContaining({ sessionOwnerId: "existing-owner" }),
    );
    expect(response.headers.get("set-cookie")).toBeNull();
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
