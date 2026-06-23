import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { readRsshubSources } from "./sources/rsshub";
import type { CreatorSource, SourceRegistrationInput } from "./types";

export class SourceRegistryError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export const DEFAULT_CREATOR_SOURCES: CreatorSource[] = [
  {
    id: "canteen-lepton-rfb",
    title: "Lepton RFB Notes",
    creator: "Canteen Research",
    handle: "@canteen",
    wallet: "0x1111111111111111111111111111111111111111",
    url: "https://lepton.thecanteenapp.com",
    summary:
      "Lepton asks builders to make sub-cent value move for agents and creators: per article, per call, per second, and per citation.",
    tags: ["lepton", "nanopayments", "creators", "arc", "x402"],
    priceAtomicUsdc: 1800,
  },
  {
    id: "circle-gateway-nano",
    title: "Gateway Nanopayments Primer",
    creator: "Circle Developer Notes",
    handle: "@circledev",
    wallet: "0x2222222222222222222222222222222222222222",
    url: "https://developers.circle.com/gateway/nanopayments",
    summary:
      "Circle Gateway batches signed EIP-3009 authorizations so x402 payments can clear at sub-cent values without per-payment gas.",
    tags: ["circle", "gateway", "eip-3009", "x402", "usdc"],
    priceAtomicUsdc: 2400,
  },
  {
    id: "arc-finality-usdc",
    title: "Arc Settlement Sketch",
    creator: "Arc Builder Desk",
    handle: "@buildonarc",
    wallet: "0x3333333333333333333333333333333333333333",
    url: "https://docs.arc.network",
    summary:
      "Arc is designed for stablecoin-native settlement with USDC gas, sub-second finality, and app kits for payment workflows.",
    tags: ["arc", "usdc", "settlement", "app-kit", "finality"],
    priceAtomicUsdc: 2200,
  },
  {
    id: "rsshub-distribution",
    title: "RSS Distribution Surface",
    creator: "Open Feed Maintainers",
    handle: "@rsshub",
    wallet: "0x4444444444444444444444444444444444444444",
    url: "https://github.com/DIYgod/RSSHub",
    summary:
      "RSS and open feed communities already aggregate creator work, making them strong surfaces for pay-per-citation and pay-per-read experiments.",
    tags: ["rss", "feeds", "distribution", "creators", "open-source"],
    priceAtomicUsdc: 900,
  },
  {
    id: "forum-mandates",
    title: "Covenant Account Spend Controls",
    creator: "Forum Protocol",
    handle: "@ggudman",
    wallet: "0x5555555555555555555555555555555555555555",
    url: "https://forum.gudman.xyz",
    summary:
      "Forum-style mandates bound an agent budget, publish receipts, and make spend controls enforceable instead of advisory.",
    tags: ["forum", "receipts", "mandates", "spend-control", "agents"],
    priceAtomicUsdc: 1500,
  },
  {
    id: "creator-citation-economics",
    title: "Citation Economics for AI Answers",
    creator: "Indie Researcher",
    handle: "@sourcepaid",
    wallet: "0x6666666666666666666666666666666666666666",
    url: "https://example.com/citation-economics",
    summary:
      "A source payment should be tiny, automatic, visible to the creator, and tied to the answer that reused the work.",
    tags: ["citations", "attribution", "publishers", "answers", "economics"],
    priceAtomicUsdc: 1200,
  },
];

const SOURCE_REGISTRY_PATH = path.join(process.cwd(), "data", "sources.json");
const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function cleanText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new SourceRegistryError(`${field} must be a string.`);
  }
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) throw new SourceRegistryError(`${field} is required.`);
  if (cleaned.length > maxLength) {
    throw new SourceRegistryError(
      `${field} must be ${maxLength} characters or less.`,
    );
  }
  return cleaned;
}

function normalizeHandle(value: unknown): string {
  const handle = cleanText(value, "handle", 48);
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function normalizeUrl(value: unknown): string {
  const raw = cleanText(value, "url", 260);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SourceRegistryError("url must be a valid URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SourceRegistryError("url must use http or https.");
  }
  return parsed.toString();
}

function normalizeWallet(value: unknown): `0x${string}` {
  const wallet = cleanText(value, "wallet", 42);
  if (!WALLET_PATTERN.test(wallet)) {
    throw new SourceRegistryError("wallet must be a 20-byte EVM address.");
  }
  return wallet as `0x${string}`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function normalizeTags(value: SourceRegistrationInput["tags"]): string[] {
  const rawTags = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const tags = rawTags
    .map((tag) =>
      tag
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .trim(),
    )
    .filter((tag) => tag.length >= 2)
    .slice(0, 8);
  return Array.from(new Set(tags));
}

function normalizePrice(
  value: SourceRegistrationInput["priceAtomicUsdc"],
): number {
  const price = typeof value === "string" ? Number(value) : value;
  if (
    typeof price !== "number" ||
    !Number.isInteger(price) ||
    price < 1 ||
    price > 1_000_000
  ) {
    throw new SourceRegistryError(
      "priceAtomicUsdc must be an integer between 1 and 1000000.",
    );
  }
  return price;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  return true;
}

function isCreatorSource(value: unknown): value is CreatorSource {
  if (!isRecord(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    typeof source.id === "string" &&
    typeof source.title === "string" &&
    typeof source.creator === "string" &&
    typeof source.handle === "string" &&
    typeof source.wallet === "string" &&
    WALLET_PATTERN.test(source.wallet) &&
    typeof source.url === "string" &&
    typeof source.summary === "string" &&
    Array.isArray(source.tags) &&
    source.tags.every((tag) => typeof tag === "string") &&
    Number.isInteger(source.priceAtomicUsdc)
  );
}

export function normalizeSourceInput(input: unknown): CreatorSource {
  if (!isRecord(input)) {
    throw new SourceRegistryError("source registration must be a JSON object.");
  }
  const registration = input as SourceRegistrationInput;
  const title = cleanText(registration.title, "title", 96);
  const creator = cleanText(registration.creator, "creator", 72);
  const sourceId = registration.id
    ? slugify(cleanText(registration.id, "id", 72))
    : slugify(title);
  if (!sourceId) throw new SourceRegistryError("id could not be derived.");

  return {
    id: sourceId,
    title,
    creator,
    handle: normalizeHandle(registration.handle),
    wallet: normalizeWallet(registration.wallet),
    url: normalizeUrl(registration.url),
    summary: cleanText(registration.summary, "summary", 340),
    tags: normalizeTags(registration.tags),
    priceAtomicUsdc: normalizePrice(registration.priceAtomicUsdc),
  };
}

async function readCustomSources(): Promise<CreatorSource[]> {
  try {
    const raw = await readFile(SOURCE_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCreatorSource);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

async function writeCustomSources(sources: CreatorSource[]): Promise<void> {
  await mkdir(path.dirname(SOURCE_REGISTRY_PATH), { recursive: true });
  const tmpPath = `${SOURCE_REGISTRY_PATH}.tmp`;
  await writeFile(tmpPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
  await rename(tmpPath, SOURCE_REGISTRY_PATH);
}

export async function readSources(): Promise<CreatorSource[]> {
  const [customSources, liveSources] = await Promise.all([
    readCustomSources(),
    readRsshubSources(),
  ]);
  const seen = new Set<string>();
  return [...liveSources, ...DEFAULT_CREATOR_SOURCES, ...customSources].filter(
    (source) => {
      if (seen.has(source.id)) return false;
      seen.add(source.id);
      return true;
    },
  );
}

export async function appendSource(
  input: unknown,
): Promise<{ source: CreatorSource; sources: CreatorSource[] }> {
  const source = normalizeSourceInput(input);
  const existingSources = await readSources();
  if (existingSources.some((existing) => existing.id === source.id)) {
    throw new SourceRegistryError("source id already exists.", 409);
  }
  const customSources = await readCustomSources();
  const nextCustomSources = [...customSources, source];
  await writeCustomSources(nextCustomSources);
  return { source, sources: [...existingSources, source] };
}

export async function findSource(
  sourceId: string,
): Promise<CreatorSource | undefined> {
  const sources = await readSources();
  return sources.find((source) => source.id === sourceId);
}
