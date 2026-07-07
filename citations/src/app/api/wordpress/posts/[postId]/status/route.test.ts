import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  authenticateWordPressSite: vi.fn(),
  wordpressPostStatus: vi.fn(),
}));

vi.mock("@/lib/wordpress", () => {
  class WordPressRegistryError extends Error {
    constructor(
      message: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  }
  return {
    WordPressRegistryError,
    authenticateWordPressSite: mocks.authenticateWordPressSite,
    wordpressPostStatus: mocks.wordpressPostStatus,
  };
});

const site = {
  id: "wp_site",
  siteUrl: "https://publisher.example/",
  creatorWallet: "0x7777777777777777777777777777777777777777",
  apiKeyHash: `0x${"a".repeat(64)}`,
  registeredAt: "2026-07-07T00:00:00.000Z",
};

function request(apiKey = "tgwp_key"): NextRequest {
  return new NextRequest(
    "http://tollgate.test/api/wordpress/posts/42/status",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tollgate-site-key": apiKey,
      },
      body: JSON.stringify({
        priceAtomicUsdc: 2500,
        requesterFingerprint: "reader",
      }),
    },
  );
}

function context(postId = "42") {
  return {
    params: Promise.resolve({ postId }),
  };
}

describe("POST /api/wordpress/posts/[postId]/status", () => {
  beforeEach(() => {
    mocks.authenticateWordPressSite.mockReset();
    mocks.wordpressPostStatus.mockReset();
  });

  it("rejects requests without a valid site key", async () => {
    mocks.authenticateWordPressSite.mockResolvedValue(null);

    const response = await POST(request("bad-key"), context());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("invalid site key");
    expect(mocks.wordpressPostStatus).not.toHaveBeenCalled();
  });

  it("returns the scoped post payment status", async () => {
    mocks.authenticateWordPressSite.mockResolvedValue(site);
    mocks.wordpressPostStatus.mockResolvedValue({
      paid: true,
      eventId: "wordpress:wp_site:42:reader",
      receipt: {
        receiptHash: "0xreceipt",
        settlementMode: "forum-routed",
      },
    });

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.wordpressPostStatus).toHaveBeenCalledWith(
      site,
      "42",
      expect.objectContaining({ priceAtomicUsdc: 2500 }),
    );
    expect(body).toEqual({
      paid: true,
      eventId: "wordpress:wp_site:42:reader",
      receiptHash: "0xreceipt",
      settlementMode: "forum-routed",
    });
  });
});
