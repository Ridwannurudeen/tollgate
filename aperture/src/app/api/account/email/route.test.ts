import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  readWalletRegistry: vi.fn(),
  writeWalletRegistry: vi.fn(),
}));

vi.mock("../../../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
  maskAccountEmail: (email: string) => email.replace(/^(.).+@/, "$1***@"),
  normalizeAccountEmail: (value: string) => {
    const trimmed = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
  },
}));

vi.mock("../../../../lib/registry", () => ({
  findWalletForOwner: (
    registry: { photographers: Array<{ ownerId: string }> },
    ownerId: string,
  ) =>
    registry.photographers.find((entry) => entry.ownerId === ownerId) ?? null,
  readWalletRegistry: mocks.readWalletRegistry,
  writeWalletRegistry: mocks.writeWalletRegistry,
  withRegistryWriteLock: async <T>(write: () => Promise<T>) => write(),
}));

function request(email: unknown): NextRequest {
  return new NextRequest("http://aperture.test/aperture/api/account/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
}

function registry(ownerEmail?: string) {
  return {
    photographers: [
      {
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        createdAt: "2026-07-06T00:00:00.000Z",
        approvalStatus: "operator-approved",
        ...(ownerEmail ? { email: ownerEmail } : {}),
      },
      {
        ownerId: "owner-2",
        displayName: "Other Lens",
        wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        createdAt: "2026-07-06T00:00:00.000Z",
        approvalStatus: "operator-approved",
        email: "claimed@example.com",
      },
    ],
  };
}

describe("POST /api/account/email", () => {
  beforeEach(() => {
    mocks.getSessionOwner.mockReset();
    mocks.readWalletRegistry.mockReset();
    mocks.writeWalletRegistry.mockReset();
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
    });
    mocks.readWalletRegistry.mockResolvedValue(registry());
  });

  it("requires a logged-in account", async () => {
    mocks.getSessionOwner.mockResolvedValue(null);

    const response = await POST(request("jane@example.com"));

    expect(response.status).toBe(401);
    expect(mocks.writeWalletRegistry).not.toHaveBeenCalled();
  });

  it("rejects malformed emails", async () => {
    const response = await POST(request("not-an-email"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("a valid email is required");
    expect(mocks.writeWalletRegistry).not.toHaveBeenCalled();
  });

  it("does not overwrite an existing account email", async () => {
    mocks.readWalletRegistry.mockResolvedValue(registry("jane@example.com"));

    const response = await POST(request("new@example.com"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe(
      "email already set - this account already has a recovery email",
    );
    expect(mocks.writeWalletRegistry).not.toHaveBeenCalled();
  });

  it("rejects an email used by another account", async () => {
    const response = await POST(request(" Claimed@Example.COM "));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(body.error).toBe("that email is already in use");
    expect(mocks.writeWalletRegistry).not.toHaveBeenCalled();
  });

  it("persists the normalized email and returns the masked display value", async () => {
    const response = await POST(request(" Jane@Example.COM "));
    const body = (await response.json()) as { ok: boolean; email: string };

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, email: "j***@example.com" });
    expect(mocks.writeWalletRegistry).toHaveBeenCalledWith({
      photographers: [
        expect.objectContaining({
          ownerId: "owner-1",
          email: "jane@example.com",
        }),
        expect.objectContaining({
          ownerId: "owner-2",
          email: "claimed@example.com",
        }),
      ],
    });
  });
});
