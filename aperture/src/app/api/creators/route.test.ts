import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  registerCreator: vi.fn(),
}));

vi.mock("../../../lib/onboarding", () => ({
  registerCreator: mocks.registerCreator,
}));

describe("POST /api/creators", () => {
  it("rejects public registration before any creator or wallet mutation", async () => {
    process.env.APERTURE_CREATOR_REGISTRATION_SECRET = "operator-capability";
    mocks.registerCreator.mockClear();
    const request = new Request(
      "https://tollgate.test/aperture/api/creators",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerId: "victim-owner",
          displayName: "Attacker",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        }),
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "invalid registration capability",
    });
    expect(mocks.registerCreator).not.toHaveBeenCalled();
  });

  it("redacts historical email text in the public creator response", async () => {
    process.env.APERTURE_CREATOR_REGISTRATION_SECRET = "operator-capability";
    mocks.registerCreator.mockResolvedValueOnce({
      ownerId: "owner-archive@example.com",
      displayName: "Archive archive@example.com",
      wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      createdAt: "2026-07-06T00:00:00.000Z",
      approvalStatus: "operator-approved",
      custody: "self",
    });
    const request = new Request("https://tollgate.test/aperture/api/creators", {
      method: "POST",
      headers: {
        authorization: "Bearer operator-capability",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ownerId: "owner-archive@example.com",
        displayName: "Archive archive@example.com",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("archive@example.com");
    expect(body.registered.wallet).toBe(
      "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
    );
  });

  it("does not expose Circle request details in registration errors", async () => {
    process.env.APERTURE_CREATOR_REGISTRATION_SECRET = "operator-capability";
    mocks.registerCreator.mockRejectedValue(
      new Error(
        "Circle request /wallets/private-circle-wallet-id failed: upstream-secret-body",
      ),
    );
    const request = new Request("https://tollgate.test/aperture/api/creators", {
      method: "POST",
      headers: {
        authorization: "Bearer operator-capability",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ownerId: "owner-1",
        displayName: "Jane Lens",
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "registration failed" });
    expect(JSON.stringify(body)).not.toContain("private-circle-wallet-id");
    expect(JSON.stringify(body)).not.toContain("upstream-secret-body");
  });
});
