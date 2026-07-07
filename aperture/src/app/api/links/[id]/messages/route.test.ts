import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({
  getSessionOwner: vi.fn(),
  assertMessageRateLimit: vi.fn(),
  findLink: vi.fn(),
  markThreadRead: vi.fn(),
  sendMessage: vi.fn(),
}));

vi.mock("../../../../../lib/account", () => ({
  getSessionOwner: mocks.getSessionOwner,
}));

vi.mock("../../../../../lib/link-rate-limit", () => ({
  assertMessageRateLimit: mocks.assertMessageRateLimit,
}));

vi.mock("../../../../../lib/link-registry", () => ({
  findLink: mocks.findLink,
}));

vi.mock("../../../../../lib/messages", () => ({
  MessageError: class MessageError extends Error {
    constructor(
      message: string,
      readonly status = 400,
    ) {
      super(message);
    }
  },
  markThreadRead: mocks.markThreadRead,
  readThread: vi.fn(),
  sendMessage: mocks.sendMessage,
}));

function context() {
  return { params: Promise.resolve({ id: "link-1" }) };
}

function postRequest(body: Record<string, unknown>) {
  return new NextRequest(
    "http://aperture.test/aperture/api/links/link-1/messages",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-real-ip": "198.51.100.50",
      },
      body: JSON.stringify(body),
    },
  );
}

function getRequest(url: string) {
  return new NextRequest(url, { method: "GET" });
}

describe("/api/links/[id]/messages", () => {
  beforeEach(() => {
    mocks.getSessionOwner.mockReset();
    mocks.assertMessageRateLimit.mockReset();
    mocks.findLink.mockReset();
    mocks.markThreadRead.mockReset();
    mocks.sendMessage.mockReset();
    mocks.findLink.mockResolvedValue({
      id: "link-1",
      title: "Photo",
      ownerId: "seller-1",
    });
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "buyer-1",
      displayName: "Buyer",
    });
    mocks.markThreadRead.mockResolvedValue([]);
    mocks.sendMessage.mockResolvedValue({
      id: "message-1",
      senderOwnerId: "buyer-1",
      body: "Question",
      createdAt: "2026-07-07T00:00:00.000Z",
    });
  });

  it("requires a logged-in account", async () => {
    mocks.getSessionOwner.mockResolvedValue(null);

    const response = await POST(postRequest({ body: "Question" }), context());

    expect(response.status).toBe(401);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("derives the buyer thread from the session owner", async () => {
    const response = await POST(
      postRequest({ buyerOwnerId: "attacker", body: "Question" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      linkId: "link-1",
      buyerOwnerId: "buyer-1",
      senderOwnerId: "buyer-1",
      body: "Question",
    });
  });

  it("rejects sellers starting a thread with themselves", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "seller-1",
      displayName: "Seller",
    });

    const response = await POST(postRequest({ body: "Question" }), context());

    expect(response.status).toBe(400);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("rate-limits sends", async () => {
    mocks.assertMessageRateLimit.mockImplementation(() => {
      throw new Error("Too many messages. Wait a minute and retry.");
    });

    const response = await POST(postRequest({ body: "Question" }), context());

    expect(response.status).toBe(429);
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("requires buyerOwnerId when a seller reads a thread", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "seller-1",
      displayName: "Seller",
    });

    const response = await GET(
      getRequest("http://aperture.test/aperture/api/links/link-1/messages"),
      context(),
    );

    expect(response.status).toBe(400);
    expect(mocks.markThreadRead).not.toHaveBeenCalled();
  });

  it("lets sellers read only explicit buyer threads for their own link", async () => {
    mocks.getSessionOwner.mockResolvedValue({
      ownerId: "seller-1",
      displayName: "Seller",
    });
    mocks.markThreadRead.mockResolvedValue([
      {
        id: "message-1",
        senderOwnerId: "buyer-1",
        body: "Question",
        createdAt: "2026-07-07T00:00:00.000Z",
      },
    ]);

    const response = await GET(
      getRequest(
        "http://aperture.test/aperture/api/links/link-1/messages?buyerOwnerId=buyer-1",
      ),
      context(),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.messages[0].body).toBe("Question");
    expect(mocks.markThreadRead).toHaveBeenCalledWith(
      "link-1",
      "buyer-1",
      "seller-1",
    );
  });
});
