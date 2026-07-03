import { safeFetch, type SafeFetchOptions } from "./safe-fetch";
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

async function fetchText(
  url: URL,
  accept: string,
  fetchOptions: SafeFetchOptions,
): Promise<{
  text: string;
  contentType: string;
}> {
  const response = await safeFetch(
    url,
    {
      headers: { accept },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    },
    fetchOptions,
  );
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

export async function discoverRssPosts(
  inputUrl: string,
  fetchOptions: SafeFetchOptions = {},
): Promise<{
  feedUrl: string;
  posts: RssImportPost[];
}> {
  const url = new URL(inputUrl);
  const first = await fetchText(
    url,
    "application/rss+xml, application/atom+xml, text/xml, text/html",
    fetchOptions,
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
        fetchOptions,
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
