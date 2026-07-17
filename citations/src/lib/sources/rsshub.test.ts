import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseCreatorFeed,
  readRsshubSources,
  RSSHUB_MAX_RESPONSE_BYTES,
  type CreatorFeedRegistration,
} from "./rsshub";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  safeFetch: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
}));

vi.mock("../safe-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../safe-fetch")>();
  return {
    ...actual,
    safeFetch: mocks.safeFetch,
  };
});

const registration: CreatorFeedRegistration = {
  id: "creator-lab",
  creator: "Creator Lab",
  handle: "@creator",
  wallet: "0x7777777777777777777777777777777777777777",
  feedUrl: "https://example.com/feed.xml",
  priceAtomicUsdc: 1100,
  tags: ["arc", "citations"],
};

beforeEach(() => {
  mocks.readFile.mockResolvedValue(JSON.stringify([registration]));
  mocks.safeFetch.mockReset();
});

describe("parseCreatorFeed", () => {
  it("parses RSS items into payable creator sources", () => {
    const sources = parseCreatorFeed(
      `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Paid citation markets</title>
            <link>https://example.com/citation-markets</link>
            <description><![CDATA[Creators earn when AI cites their work.]]></description>
            <category>payments</category>
          </item>
        </channel>
      </rss>`,
      registration,
    );

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id: "creator-lab-paid-citation-markets",
      creator: "Creator Lab",
      wallet: "0x7777777777777777777777777777777777777777",
      priceAtomicUsdc: 1100,
    });
    expect(sources[0].tags).toContain("payments");
  });

  it("parses Atom entries with alternate links", () => {
    const sources = parseCreatorFeed(
      `<?xml version="1.0"?>
      <feed>
        <entry>
          <title>Agent receipts</title>
          <link rel="alternate" href="https://example.com/agent-receipts" />
          <summary>Receipts make agent spending inspectable.</summary>
          <category term="receipts" />
        </entry>
      </feed>`,
      registration,
    );

    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("https://example.com/agent-receipts");
    expect(sources[0].summary).toBe(
      "Receipts make agent spending inspectable.",
    );
    expect(sources[0].tags).toContain("receipts");
  });
});

describe("readRsshubSources", () => {
  it("fetches registered feeds through the safe-fetch transport", async () => {
    mocks.safeFetch.mockResolvedValue(
      new Response(
        `<rss><channel><item><title>Safe feed</title><link>https://example.com/safe</link><description>Safe body.</description></item></channel></rss>`,
        {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        },
      ),
    );

    const sources = await readRsshubSources();

    expect(mocks.safeFetch).toHaveBeenCalledTimes(1);
    expect(sources).toMatchObject([
      {
        title: "Safe feed",
        url: "https://example.com/safe",
      },
    ]);
  });

  it("cancels an oversized chunked registered feed", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(RSSHUB_MAX_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });
    mocks.safeFetch.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const sources = await readRsshubSources();

      expect(sources).toEqual([]);
      expect(cancelled).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("response body exceeds"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
