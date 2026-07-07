import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  assertMessageRateLimit: vi.fn(),
  findLink: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("../../../../../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
}));

vi.mock("../../../../../../lib/link-rate-limit", () => ({
  assertMessageRateLimit: mocks.assertMessageRateLimit,
}));

vi.mock("../../../../../../lib/link-registry", () => ({
  findLink: mocks.findLink,
}));

vi.mock("../../../../../../lib/messages", () => ({
  MessageError: class MessageError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
  sendMessage: mocks.sendMessage,
}));

function context() {
  return { params: Promise.resolve({ id: "link-1" }) };
}

function request(body: Record<string, unknown>) {
  return new NextRequest(
    "http://aperture.test/aperture/api/links/link-1/messages/reply",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "198.51.100.51",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("/api/links/[id]/messages/reply", () => {
  beforeEach(() => {
    mocks.getSessionOwner.mockReset();
    mocks.assertMessageRateLimit.mockReset();
    mocks.findLink.mockReset();
    mocks.sendMessage.mockReset();
    mocks.findLink.mockResolvedValue({
      id: "link-1",
      title: "Photo",
      ownerId: "seller-1",
    });
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "seller-1",
      displayName: "Seller",
    });
    mocks.sendMessage.mockResolvedValue({
      id: "message-2",
      senderOwnerId: "seller-1",
      body: "Reply",
      createdAt: "2026-07-07T00:00:00.000Z",
    });
  });

  it("requires the actual seller", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "buyer-1",
      displayName: "Buyer",
    });

    const response = await POST(
      request({ buyerOwnerId: "buyer-1", body: "Reply" }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("sends a seller reply to the specified buyer thread", async () => {
    const response = await POST(
      request({ buyerOwnerId: "buyer-1", body: "Reply" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      linkId: "link-1",
      buyerOwnerId: "buyer-1",
      senderOwnerId: "seller-1",
      body: "Reply",
    });
  });
});
