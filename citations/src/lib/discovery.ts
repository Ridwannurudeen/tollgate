import type { SourceRegistrationInput } from "./types";

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;
// Caps how many declared sources are materialized from a single tollgate.json,
// so a declaration claiming millions of entries can't be fully mapped before
// the caller truncates. Matches the endpoint's per-call registration cap.
const MAX_DECLARED_SOURCES = 20;

export type TollgateSourceDeclaration = {
  url: string;
  priceAtomicUsdc: number;
  title?: string;
  summary?: string;
  tags?: string[];
};

export type TollgateDeclaration = {
  version: string;
  wallet: `0x${string}`;
  defaultPriceAtomicUsdc: number;
  sources: TollgateSourceDeclaration[];
};

function integerPrice(value: unknown, field: string): number {
  const price = typeof value === "string" ? Number(value) : value;
  if (
    typeof price !== "number" ||
    !Number.isInteger(price) ||
    price < 1 ||
    price > 1_000_000
  ) {
    throw new Error(`${field} must be an integer from 1 to 1000000.`);
  }
  return price;
}

function wallet(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !WALLET_PATTERN.test(value)) {
    throw new Error("wallet must be a 20-byte EVM address.");
  }
  return value as `0x${string}`;
}

function tags(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value))
    throw new Error("sources[].tags must be an array.");
  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) =>
      tag
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .trim(),
    )
    .filter((tag) => tag.length >= 2)
    .slice(0, 8);
}

function sourceUrl(value: unknown, baseUrl: URL): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("sources[].url must be a URL string.");
  }
  const url = new URL(value, baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("sources[].url must use http or https.");
  }
  return url.toString();
}

export function parseTollgateJson(
  value: unknown,
  baseUrl: string,
): TollgateDeclaration {
  if (!value || typeof value !== "object") {
    throw new Error("tollgate.json must be an object.");
  }
  const record = value as Record<string, unknown>;
  const version = typeof record.version === "string" ? record.version : "";
  if (version !== "1") throw new Error("tollgate.json version must be 1.");
  const base = new URL(baseUrl);
  const defaultPriceAtomicUsdc = integerPrice(
    record.defaultPriceAtomicUsdc,
    "defaultPriceAtomicUsdc",
  );
  const declaredSources = (
    Array.isArray(record.sources) ? record.sources : []
  ).slice(0, MAX_DECLARED_SOURCES);
  const sources = declaredSources.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`sources[${index}] must be an object.`);
    }
    const source = item as Record<string, unknown>;
    return {
      url: sourceUrl(source.url, base),
      priceAtomicUsdc:
        source.priceAtomicUsdc === undefined
          ? defaultPriceAtomicUsdc
          : integerPrice(source.priceAtomicUsdc, "sources[].priceAtomicUsdc"),
      ...(typeof source.title === "string" && source.title.trim()
        ? { title: source.title.trim() }
        : {}),
      ...(typeof source.summary === "string" && source.summary.trim()
        ? { summary: source.summary.trim() }
        : {}),
      ...(tags(source.tags) ? { tags: tags(source.tags) } : {}),
    };
  });

  return {
    version,
    wallet: wallet(record.wallet),
    defaultPriceAtomicUsdc,
    sources:
      sources.length > 0
        ? sources
        : [
            {
              url: base.toString(),
              priceAtomicUsdc: defaultPriceAtomicUsdc,
            },
          ],
  };
}

export function parseTollgateMeta(
  html: string,
  baseUrl: string,
): TollgateDeclaration | null {
  const metaPattern = /<meta\b[^>]*>/gi;
  const attrPattern = /([a-zA-Z:-]+)\s*=\s*["']([^"']*)["']/g;
  for (const match of html.matchAll(metaPattern)) {
    const attrs = new Map<string, string>();
    for (const attr of match[0].matchAll(attrPattern)) {
      attrs.set(attr[1].toLowerCase(), attr[2]);
    }
    if (attrs.get("name") !== "tollgate") continue;
    const fields = new Map(
      (attrs.get("content") ?? "")
        .split(";")
        .map((field) => field.trim())
        .filter(Boolean)
        .map((field) => {
          const [key, ...rest] = field.split("=");
          return [key.trim(), rest.join("=").trim()] as const;
        }),
    );
    const defaultPriceAtomicUsdc = integerPrice(
      fields.get("price"),
      "meta price",
    );
    return {
      version: "1",
      wallet: wallet(fields.get("wallet")),
      defaultPriceAtomicUsdc,
      sources: [
        {
          url: new URL(baseUrl).toString(),
          priceAtomicUsdc: defaultPriceAtomicUsdc,
        },
      ],
    };
  }
  return null;
}

export function discoveryRegistrations(
  declaration: TollgateDeclaration,
  publisherUrl: string,
): SourceRegistrationInput[] {
  const host = new URL(publisherUrl).hostname;
  return declaration.sources.map((source, index) => ({
    title: source.title ?? `Discovered source ${host} ${index + 1}`,
    creator: host,
    handle: `@${host.replace(/[^a-z0-9]/gi, "").slice(0, 32) || "publisher"}`,
    wallet: declaration.wallet,
    url: source.url,
    summary: source.summary ?? `Open-web Tollgate source declared by ${host}.`,
    tags: source.tags ?? ["discovered", "tollgate"],
    priceAtomicUsdc: source.priceAtomicUsdc,
    origin: "discovered",
  }));
}
