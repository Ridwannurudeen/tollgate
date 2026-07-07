import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  assertWordPressPayRateLimit: vi.fn(),
  authenticateWordPressSite: vi.fn(),
  settleWordPressPost: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  assertWordPressPayRateLimit: mocks.assertWordPressPayRateLimit,
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
    settleWordPressPost: mocks.settleWordPressPost,
  };
});

const site = {
  id: "wp_site",
  siteUrl: "https://publisher.example/",
  creatorWallet: "0x7777777777777777777777777777777777777777",
  apiKeyHash: `0x${"a".repeat(64)}`,
  registeredAt: "2026-07-07T00:00:00.000Z",
};

function request(ip = "198.51.100.9"): NextRequest {
  return new NextRequest("http://tollgate.test/api/wordpress/posts/42/pay", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      "x-tollgate-site-key": "tgwp_key",
    },
    body: JSON.stringify({
      priceAtomicUsdc: 2500,
      requesterFingerprint: "reader",
    }),
  });
}

function context(postId = "42") {
  return {
    params: Promise.resolve({ postId }),
  };
}

describe("POST /api/wordpress/posts/[postId]/pay", () => {
  beforeEach(() => {
    mocks.assertWordPressPayRateLimit.mockReset();
    mocks.authenticateWordPressSite.mockReset();
    mocks.settleWordPressPost.mockReset();
  });

  it("rejects requests without a valid site key", async () => {
    mocks.authenticateWordPressSite.mockResolvedValue(null);

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toBe("invalid site key");
    expect(mocks.assertWordPressPayRateLimit).not.toHaveBeenCalled();
    expect(mocks.settleWordPressPost).not.toHaveBeenCalled();
  });

  it("rate-limits authenticated settlement attempts per site and IP", async () => {
    mocks.authenticateWordPressSite.mockResolvedValue(site);
    mocks.assertWordPressPayRateLimit.mockImplementation(() => {
      throw new Error("Too many WordPress payment attempts.");
    });

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error).toBe("Too many WordPress payment attempts.");
    expect(mocks.assertWordPressPayRateLimit).toHaveBeenCalledWith(
      "wp_site:198.51.100.9",
    );
    expect(mocks.settleWordPressPost).not.toHaveBeenCalled();
  });

  it("settles a post payment and reports the receipt", async () => {
    mocks.authenticateWordPressSite.mockResolvedValue(site);
    mocks.settleWordPressPost.mockResolvedValue({
      paid: true,
      created: true,
      eventId: "wordpress:wp_site:42:reader",
      query: { id: "wordpress:wp_site:42:reader" },
      receipt: {
        receiptHash: "0xreceipt",
        settlementMode: "forum-routed",
        amountAtomicUsdc: 2500,
      },
    });

    const response = await POST(request(), context());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.settleWordPressPost).toHaveBeenCalledWith(
      site,
      "42",
      expect.objectContaining({ priceAtomicUsdc: 2500 }),
    );
    expect(body).toEqual({
      paid: true,
      created: true,
      eventId: "wordpress:wp_site:42:reader",
      queryId: "wordpress:wp_site:42:reader",
      receiptHash: "0xreceipt",
      settlementMode: "forum-routed",
      amountAtomicUsdc: 2500,
    });
  });
});
