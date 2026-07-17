import { describe, expect, it } from "vitest";
import {
  RSS_IMPORT_MAX_RESPONSE_BYTES,
  discoverRssPosts,
} from "./rss-import";

describe("RSS import response limits", () => {
  it("aborts an oversized chunked feed before XML decoding", async () => {
    let cancelled = false;
    const feed = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Bounded feed</title>
            <link>https://publisher.example/post</link>
            <description>One valid post.</description>
          </item>
        </channel>
      </rss>`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            feed.padEnd(RSS_IMPORT_MAX_RESPONSE_BYTES, " "),
          ),
        );
        controller.enqueue(new Uint8Array([1]));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(
      discoverRssPosts("https://publisher.example/feed.xml", {
        fetchImpl: async () =>
          new Response(stream, {
            status: 200,
            headers: { "content-type": "application/rss+xml" },
          }),
        resolveHost: async () => ["93.184.216.34"],
      }),
    ).rejects.toThrow(/response body exceeds/i);
    expect(cancelled).toBe(true);
  });

  it("still parses a bounded chunked feed", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `<?xml version="1.0"?><rss version="2.0"><channel><item>`,
          ),
        );
        controller.enqueue(
          encoder.encode(
            `<title>Bounded feed</title><link>https://publisher.example/post</link><description>One valid post.</description></item></channel></rss>`,
          ),
        );
        controller.close();
      },
    });

    await expect(
      discoverRssPosts("https://publisher.example/feed.xml", {
        fetchImpl: async () =>
          new Response(stream, {
            status: 200,
            headers: { "content-type": "application/rss+xml" },
          }),
        resolveHost: async () => ["93.184.216.34"],
      }),
    ).resolves.toMatchObject({
      feedUrl: "https://publisher.example/feed.xml",
      posts: [
        {
          title: "Bounded feed",
          url: "https://publisher.example/post",
        },
      ],
    });
  });
});
