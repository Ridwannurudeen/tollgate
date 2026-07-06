import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  readWalletRegistry: vi.fn(),
  writeWalletRegistry: vi.fn(),
}));

vi.mock("../../../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
}));

vi.mock("../../../../lib/registry", () => ({
  readWalletRegistry: mocks.readWalletRegistry,
  writeWalletRegistry: mocks.writeWalletRegistry,
  withRegistryWriteLock: async <T>(write: () => Promise<T>) => write(),
}));

function request(wallet: unknown): NextRequest {
  return new NextRequest("http://aperture.test/aperture/api/account/wallets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
}

function registry(linkedWallets: string[] = []) {
  return {
    photographers: [
      {
        ownerId: "owner-1",
        displayName: "Jane Lens",
        wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
        createdAt: "2026-07-06T00:00:00.000Z",
        approvalStatus: "operator-approved",
        linkedWallets,
      },
    ],
  };
}

describe("/api/account/wallets", () => {
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

    const response = await POST(
      request("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    );

    expect(response.status).toBe(401);
    expect(mocks.writeWalletRegistry).not.toHaveBeenCalled();
  });

  it("adds lowercased linked wallets and dedupes repeats", async () => {
    mocks.readWalletRegistry.mockResolvedValue(
      registry(["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]),
    );

    const response = await POST(
      request("0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
    );
    const body = (await response.json()) as { linkedWallets: string[] };

    expect(response.status).toBe(200);
    expect(body.linkedWallets).toEqual([
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
    expect(mocks.writeWalletRegistry).toHaveBeenCalledWith({
      photographers: [
        expect.objectContaining({
          linkedWallets: ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
        }),
      ],
    });
  });

  it("rejects malformed wallets", async () => {
    const response = await POST(request("bad"));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("wallet must be a 20-byte EVM address");
    expect(mocks.writeWalletRegistry).not.toHaveBeenCalled();
  });

  it("caps linked wallets at ten", async () => {
    mocks.readWalletRegistry.mockResolvedValue(
      registry(
        Array.from(
          { length: 10 },
          (_, index) => `0x${String(index).repeat(40).slice(0, 40)}`,
        ),
      ),
    );

    const response = await POST(
      request("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe("linked wallet limit reached.");
  });

  it("removes linked wallets", async () => {
    mocks.readWalletRegistry.mockResolvedValue(
      registry([
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ]),
    );

    const response = await DELETE(
      request("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    );
    const body = (await response.json()) as { linkedWallets: string[] };

    expect(response.status).toBe(200);
    expect(body.linkedWallets).toEqual([
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ]);
  });
});
