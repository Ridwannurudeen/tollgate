import { describe, expect, it } from "vitest";
import { buildSourceContent } from "./source-content";
import type { CreatorSource } from "./types";

const source: CreatorSource = {
  id: "real-content-source",
  title: "Real Content Source",
  creator: "Grounded Writer",
  handle: "@grounded",
  wallet: "0x7777777777777777777777777777777777777777",
  url: "https://example.com/real-content",
  summary: "Registration summary only.",
  tags: ["grounding", "content"],
  priceAtomicUsdc: 1_500,
  sourceKind: "external",
  creatorKind: "external",
  verifiedCreator: true,
};

describe("buildSourceContent", () => {
  it("uses stored page content for the paid excerpt when present", () => {
    const content = buildSourceContent(
      {
        ...source,
        contentExcerpt: "Actual fetched article text with richer claims.",
      },
      "2026-07-05T00:00:00.000Z",
    );

    expect(content.previewExcerpt).toBe(source.summary);
    expect(content.paidExcerpt).toContain(
      "Excerpt: Actual fetched article text with richer claims.",
    );
    expect(content.paidExcerpt).not.toContain(
      "Excerpt: Registration summary only.",
    );
  });

  it("falls back to the source summary when no content excerpt exists", () => {
    const content = buildSourceContent(source, "2026-07-05T00:00:00.000Z");

    expect(content.previewExcerpt).toBe(source.summary);
    expect(content.paidExcerpt).toContain(
      "Excerpt: Registration summary only.",
    );
  });
});
