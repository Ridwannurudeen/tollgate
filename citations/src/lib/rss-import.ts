import { parseCreatorFeed } from "./sources/rsshub";

const DISCOVERY_TIMEOUT_MS = 5_000;
const MAX_IMPORT_POSTS = 20;

export type RssImportPost = {
  title: string;
  url: string;
  summary: string;
  tags: string[];
};

function candidateFeedUrls(url: URL): URL[] {
  return ["/feed", "/rss.xml", "/atom.xml"].map((pathname) => {
    const candidate = new URL(url);
    candidate.pathname = pathname;
    candidate.search = "";
    candidate.hash = "";
    return candidate;
  });
}

function alternateFeedUrl(html: string, baseUrl: URL): URL | null {
  const linkPattern = /<link\s+[^>]*rel=["'][^"']*alternate[^"']*["'][^>]*>/gi;
  const hrefPattern = /\shref=["']([^"']+)["']/i;
  const typePattern = /\stype=["']([^"']+)["']/i;
  for (const match of html.matchAll(linkPattern)) {
    const tag = match[0];
    const type = tag.match(typePattern)?.[1] ?? "";
    if (!/(rss|atom|xml)/i.test(type)) continue;
    const href = tag.match(hrefPattern)?.[1];
    if (href) return new URL(href, baseUrl);
  }
  return null;
}

function assertSafeFetchUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("feed URL must use http or https.");
  }
  const host = url.hostname.toLowerCase();
  const unsafe =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "0.0.0.0" ||
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host);
  if (unsafe) throw new Error("feed host is not allowed.");
}

async function fetchText(url: URL, accept: string): Promise<{
  text: string;
  contentType: string;
}> {
  assertSafeFetchUrl(url);
  const response = await fetch(url, {
    headers: { accept },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    text: await response.text(),
    contentType: response.headers.get("content-type") ?? "",
  };
}

function parsePosts(xml: string, feedUrl: URL): RssImportPost[] {
  return parseCreatorFeed(xml, {
    id: "import",
    creator: "Imported Creator",
    handle: "@import",
    wallet: "0x1111111111111111111111111111111111111111",
    feedUrl: feedUrl.toString(),
    priceAtomicUsdc: 1000,
    tags: ["rss"],
  })
    .map((source) => ({
      title: source.title,
      url: source.url,
      summary: source.summary,
      tags: source.tags,
    }))
    .slice(0, MAX_IMPORT_POSTS);
}

export async function discoverRssPosts(inputUrl: string): Promise<{
  feedUrl: string;
  posts: RssImportPost[];
}> {
  const url = new URL(inputUrl);
  const first = await fetchText(
    url,
    "application/rss+xml, application/atom+xml, text/xml, text/html",
  );
  if (/(rss|atom|xml)/i.test(first.contentType)) {
    return { feedUrl: url.toString(), posts: parsePosts(first.text, url) };
  }
  const discovered = alternateFeedUrl(first.text, url);
  const candidates = discovered
    ? [discovered, ...candidateFeedUrls(url)]
    : candidateFeedUrls(url);
  let lastError = "no candidates tried";
  for (const candidate of candidates) {
    try {
      const feed = await fetchText(
        candidate,
        "application/rss+xml, application/atom+xml, text/xml",
      );
      const posts = parsePosts(feed.text, candidate);
      if (posts.length > 0) {
        return { feedUrl: candidate.toString(), posts };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "unknown error";
    }
  }
  throw new Error(`No RSS or Atom feed was found: ${lastError}`);
}
