import { describe, expect, it } from "vitest";
import { parseCreatorFeed, type CreatorFeedRegistration } from "./rsshub";

const registration: CreatorFeedRegistration = {
  id: "creator-lab",
  creator: "Creator Lab",
  handle: "@creator",
  wallet: "0x7777777777777777777777777777777777777777",
  feedUrl: "https://example.com/feed.xml",
  priceAtomicUsdc: 1100,
  tags: ["arc", "citations"],
};

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
