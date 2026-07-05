import { sha256Hex } from "./hash";
import type { CreatorSource } from "./types";

export type SourceContent = {
  sourceId: string;
  canonicalUrl: string;
  fetchedAt: string;
  previewExcerpt: string;
  paidExcerpt: string;
  contentHash: string;
  excerptHash: string;
};

function canonicalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function sourceKindLabel(source: CreatorSource): string {
  if (source.sourceKind === "seed") return "Seed/demo content";
  if (source.sourceKind === "internal-test") return "Internal test content";
  return source.verifiedCreator
    ? "Externally registered verified content"
    : "Externally registered unverified content";
}

export function buildSourceContent(
  source: CreatorSource,
  fetchedAt: string,
): SourceContent {
  const canonicalUrl = canonicalizeUrl(source.url);
  const previewExcerpt = source.summary.slice(0, 180);
  const paidExcerpt = [
    `${sourceKindLabel(source)} from ${source.creator}.`,
    `Title: ${source.title}.`,
    `Excerpt: ${source.contentExcerpt?.trim() ? source.contentExcerpt.trim() : source.summary}`,
    `Tags: ${source.tags.join(", ")}.`,
    `Canonical URL: ${canonicalUrl}.`,
  ].join(" ");

  return {
    sourceId: source.id,
    canonicalUrl,
    fetchedAt,
    previewExcerpt,
    paidExcerpt,
    contentHash: sha256Hex({
      sourceId: source.id,
      canonicalUrl,
      fetchedAt,
      paidExcerpt,
    }),
    excerptHash: sha256Hex({
      sourceId: source.id,
      canonicalUrl,
      previewExcerpt,
      paidExcerpt,
    }),
  };
}
