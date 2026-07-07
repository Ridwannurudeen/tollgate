import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  readThreadsForOwner: vi.fn(),
}));

vi.mock("../../../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
}));

vi.mock("../../../../lib/messages", () => ({
  readThreadsForOwner: mocks.readThreadsForOwner,
}));

describe("/api/messages/inbox", () => {
  beforeEach(() => {
    mocks.getSessionOwner.mockReset();
    mocks.readThreadsForOwner.mockReset();
  });

  it("requires a logged-in account", async () => {
    mocks.getSessionOwner.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.readThreadsForOwner).not.toHaveBeenCalled();
  });

  it("returns only the session owner's thread summaries", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "seller-1",
      displayName: "Seller",
    });
    mocks.readThreadsForOwner.mockResolvedValue([
      {
        linkId: "link-1",
        buyerOwnerId: "buyer-1",
        sellerOwnerId: "seller-1",
        linkTitle: "Photo",
        counterpartyOwnerId: "buyer-1",
        counterpartyName: "Buyer",
        viewerRole: "seller",
        latestMessage: "Question",
        latestAt: "2026-07-07T00:00:00.000Z",
        unreadCount: 1,
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.threads[0].counterpartyName).toBe("Buyer");
    expect(mocks.readThreadsForOwner).toHaveBeenCalledWith("seller-1");
  });
});
