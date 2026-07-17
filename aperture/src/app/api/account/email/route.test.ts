import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  writeWalletRegistry: vi.fn(),
}));

vi.mock("../../../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
}));

vi.mock("../../../../lib/registry", () => ({
  writeWalletRegistry: mocks.writeWalletRegistry,
}));

describe("POST /api/account/email", () => {
  beforeEach(() => {
    mocks.getSessionOwner.mockReset();
    mocks.writeWalletRegistry.mockReset();
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "owner-1",
      displayName: "Jane Lens",
    });
  });

  it("requires a logged-in account", async () => {
    mocks.getSessionOwner.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.writeWalletRegistry).not.toHaveBeenCalled();
  });

  it("does not bind an email without proof from an emailed link", async () => {
    const response = await POST();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(body.error).toContain("verified email link");
    expect(mocks.writeWalletRegistry).not.toHaveBeenCalled();
  });
});
