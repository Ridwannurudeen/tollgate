import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  handleLinkRegistration: vi.fn(),
}));

vi.mock("../../../lib/link-registration", () => ({
  handleLinkRegistration: mocks.handleLinkRegistration,
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
  it("rate-limits the eleventh registration per IP", async () => {
    mocks.handleLinkRegistration.mockResolvedValue({
      link: { id: "link-1", title: "Photo", priceAtomicUsdc: 2500 },
      registered: {
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
});
