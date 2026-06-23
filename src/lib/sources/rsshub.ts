import { readFile } from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { CreatorSource } from "../types";

const CREATOR_REGISTRY_PATH = path.join(
  process.cwd(),
  "data",
  "creator-registry.json",
);
const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const MAX_FEED_ITEMS_PER_CREATOR = 8;

export type CreatorFeedRegistration = {
  id: string;
  creator: string;
  handle: string;
  wallet: `0x${string}`;
  feedUrl: string;
  priceAtomicUsdc: number;
  tags: string[];
};

type FeedItem = {
  title: string;
  url: string;
  summary: string;
  tags: string[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  trimValues: true,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).replace(/\s+/g, " ").trim();
  }
  if (isRecord(value)) return textValue(value["#text"]);
  return "";
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeHandle(value: string): string {
  return value.startsWith("@") ? value : `@${value}`;
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(
    new Set(
      tags
        .flatMap((tag) => tag.split(","))
        .map((tag) =>
          tag
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, "")
            .trim(),
        )
        .filter((tag) => tag.length >= 2),
    ),
  ).slice(0, 8);
}

function isRegistration(value: unknown): value is CreatorFeedRegistration {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.creator === "string" &&
    typeof value.handle === "string" &&
    typeof value.wallet === "string" &&
    WALLET_PATTERN.test(value.wallet) &&
    typeof value.feedUrl === "string" &&
    typeof value.priceAtomicUsdc === "number" &&
    Number.isInteger(value.priceAtomicUsdc) &&
    value.priceAtomicUsdc > 0 &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string")
  );
}

function linkFromAtom(value: unknown): string {
  const links = asArray(value);
  const alternate = links.find(
    (link) =>
      isRecord(link) && (!link["@_rel"] || link["@_rel"] === "alternate"),
  );
  const link = alternate ?? links[0];
  if (isRecord(link) && typeof link["@_href"] === "string") {
    return link["@_href"];
  }
  return textValue(link);
}

function tagsFromCategory(value: unknown): string[] {
  return asArray(value)
    .map((category) => {
      if (isRecord(category) && typeof category["@_term"] === "string") {
        return category["@_term"];
      }
      return textValue(category);
    })
    .filter(Boolean);
}

function rssItems(parsed: unknown): unknown[] {
  if (!isRecord(parsed) || !isRecord(parsed.rss)) return [];
  const channel = parsed.rss.channel;
  if (!isRecord(channel)) return [];
  return asArray(channel.item);
}

function atomItems(parsed: unknown): unknown[] {
  if (!isRecord(parsed) || !isRecord(parsed.feed)) return [];
  return asArray(parsed.feed.entry);
}

function itemFromRss(value: unknown): FeedItem | null {
  if (!isRecord(value)) return null;
  const title = textValue(value.title);
  const url = textValue(value.link);
  const summary = stripMarkup(
    textValue(value.description) ||
      textValue(value["content:encoded"]) ||
      title,
  );
  if (!title || !url || !summary) return null;
  return {
    title,
    url,
    summary,
    tags: tagsFromCategory(value.category),
  };
}

function itemFromAtom(value: unknown): FeedItem | null {
  if (!isRecord(value)) return null;
  const title = textValue(value.title);
  const url = linkFromAtom(value.link);
  const summary = stripMarkup(
    textValue(value.summary) || textValue(value.content) || title,
  );
  if (!title || !url || !summary) return null;
  return {
    title,
    url,
    summary,
    tags: tagsFromCategory(value.category),
  };
}

export async function readCreatorFeedRegistry(): Promise<
  CreatorFeedRegistration[]
> {
  try {
    const raw = await readFile(CREATOR_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRegistration).map((entry) => ({
      ...entry,
      handle: normalizeHandle(entry.handle),
      tags: normalizeTags(entry.tags),
    }));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

export function parseCreatorFeed(
  xml: string,
  registration: CreatorFeedRegistration,
): CreatorSource[] {
  const parsed = parser.parse(xml) as unknown;
  const items = rssItems(parsed)
    .map(itemFromRss)
    .concat(atomItems(parsed).map(itemFromAtom))
    .filter((item): item is FeedItem => item !== null)
    .slice(0, MAX_FEED_ITEMS_PER_CREATOR);

  return items.map((item) => ({
    id: `${slugify(registration.id)}-${slugify(item.title)}`,
    title: item.title.slice(0, 96),
    creator: registration.creator,
    handle: registration.handle,
    wallet: registration.wallet,
    url: item.url,
    summary: item.summary.slice(0, 340),
    tags: normalizeTags([...registration.tags, ...item.tags, "rss", "creator"]),
    priceAtomicUsdc: registration.priceAtomicUsdc,
  }));
}

export async function readRsshubSources(): Promise<CreatorSource[]> {
  const registrations = await readCreatorFeedRegistry();
  const sources: CreatorSource[] = [];

  for (const registration of registrations) {
    try {
      const response = await fetch(registration.feedUrl, {
        headers: {
          accept: "application/rss+xml, application/atom+xml, text/xml",
        },
      });
      if (!response.ok) {
        throw new Error(`feed returned HTTP ${response.status}`);
      }
      sources.push(...parseCreatorFeed(await response.text(), registration));
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`Skipping creator feed ${registration.id}: ${message}`);
    }
  }

  return sources;
}
