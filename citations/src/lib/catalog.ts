import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyMessage } from "viem";
import { w3sMintWallet, type MintedWallet } from "./circle-w3s";
import { sha256Hex } from "./hash";
import { safeFetch } from "./safe-fetch";
import { readRsshubSources } from "./sources/rsshub";
import type {
  CreatorSource,
  SourceContributor,
  SourceOwnershipProof,
  SourceRegistrationInput,
} from "./types";

export class SourceRegistryError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

const SEED_VERIFIED_AT = "2026-06-27T00:00:00.000Z";

function seedSource(
  source: Omit<
    CreatorSource,
    "sourceKind" | "creatorKind" | "verifiedCreator" | "ownershipProof"
  >,
): CreatorSource {
  return {
    ...source,
    sourceKind: "seed",
    creatorKind: "seed",
    verifiedCreator: false,
    ownershipProof: {
      method: "seed-demo",
      verifiedAt: SEED_VERIFIED_AT,
    },
  };
}

export const DEFAULT_CREATOR_SOURCES: CreatorSource[] = [
  seedSource({
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
  }),
  seedSource({
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
  }),
  seedSource({
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
  }),
  seedSource({
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
  }),
  seedSource({
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
  }),
  seedSource({
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
  }),
  seedSource({
    id: "x402-settlement-schemes",
    title: "x402 Settlement Schemes on Arc",
    creator: "Payments Protocol Notes",
    handle: "@x402notes",
    wallet: "0x7777777777777777777777777777777777777777",
    url: "https://x402.org",
    summary:
      "x402 turns HTTP 402 into a real payment step: a resource returns payment requirements, the client signs an EIP-3009 USDC authorization, and the server settles it. The 'exact' scheme settles that authorization directly on Arc as a single USDC transfer, so the reader's debit is a verifiable on-chain transaction. The Circle Gateway-batched scheme instead pools many signed authorizations for gasless sub-cent settlement, referenced by a Gateway payment id rather than one Arc tx.",
    tags: ["x402", "eip-3009", "settlement", "arc", "usdc"],
    priceAtomicUsdc: 1300,
  }),
  seedSource({
    id: "feerouter-splits-receipts",
    title: "FeeRouter Split Payouts and Receipts",
    creator: "Receipt Ledger Notes",
    handle: "@receiptledger",
    wallet: "0x8888888888888888888888888888888888888888",
    url: "https://forum.gudman.xyz/fee-router",
    summary:
      "The FeeRouter contract pays a creator by routing USDC through an on-chain split keyed to the creator's wallet and basis-point shares, so multi-contributor works divide automatically. Each payout emits an evidence receipt hash-chained into a tamper-evident ledger. Sub-cent citations accrue to a claimable FeeRouter balance the creator withdraws with a single claim call, which keeps per-citation gas from swamping the payment.",
    tags: ["feerouter", "splits", "receipts", "payouts", "arc"],
    priceAtomicUsdc: 1600,
  }),
  seedSource({
    id: "autonomous-source-buying",
    title: "How a Source-Buying Answer Agent Works",
    creator: "Agent Commerce Notes",
    handle: "@agentcommerce",
    wallet: "0x9999999999999999999999999999999999999999",
    url: "https://example.com/source-buying-agent",
    summary:
      "An autonomous answer agent appraises candidate sources for relevance, allocates a fixed micro-budget to the best grounding-per-USDC, and buys only what it needs. It drafts an answer grounded strictly in the purchased content, self-critiques to drop any claim a purchased source does not support, and can buy one more source during reflection. Every step is recorded and hashed into the answer, so the reasoning and the payments are auditable together.",
    tags: ["agents", "rag", "budget", "citations", "grounding"],
    priceAtomicUsdc: 1300,
  }),
  seedSource({
    id: "unverified-source-escrow",
    title: "Escrow and Ownership Verification",
    creator: "Creator Licensing Desk",
    handle: "@creatorlicensing",
    wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    url: "https://example.com/ownership-escrow",
    summary:
      "A newly registered source is probationary until its owner proves control of the source domain with a DNS TXT record or meta tag. A wallet signature can confirm the payout wallet, but it does not clear probation by itself. Until domain verification passes, citation payouts for that source are escrowed rather than released. This stops an anonymous registrant from pointing someone else's URL at their own wallet to divert a creator's earnings.",
    tags: ["escrow", "verification", "ownership", "creators", "payouts"],
    priceAtomicUsdc: 1400,
  }),
  seedSource({
    id: "custodial-payer-wallets",
    title: "Keyless Custodial Wallets for Readers",
    creator: "Custodial Wallet Notes",
    handle: "@custodialnotes",
    wallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    url: "https://developers.circle.com/w3s",
    summary:
      "Circle's developer-controlled (W3S) wallets let a reader pay without holding keys or a browser wallet: the server provisions a custodial wallet and signs the x402 EIP-3009 authorization through Circle's API. This makes a one-click paid query possible for someone who has never touched crypto, while the payment still settles as real USDC on Arc and pays the cited creators through the same FeeRouter.",
    tags: ["circle", "w3s", "custodial", "x402", "usdc"],
    priceAtomicUsdc: 1400,
  }),
];

const SOURCE_REGISTRY_PATH = path.join(process.cwd(), "data", "sources.json");
const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const REGISTRATION_FETCH_TIMEOUT_MS = 5_000;
const SOURCE_CONTENT_MAX_BYTES = 200_000;
const SOURCE_CONTENT_EXCERPT_MAX_CHARS = 2_000;
const SOURCE_CONTENT_TYPE_PATTERN =
  /(text\/html|application\/xhtml\+xml|application\/rss\+xml|application\/atom\+xml|text\/xml|application\/xml)/i;
// High enough for one full RSS import (20 posts) plus a few singles;
// override with TOLLGATE_REGISTRATION_CAP_PER_WALLET_PER_DAY.
const DEFAULT_REGISTRATION_CAP_PER_WALLET_PER_DAY = 25;
const W3S_BLOCKCHAIN = "ARC-TESTNET";

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

function normalizeOptionalWallet(value: unknown): `0x${string}` | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return normalizeWallet(value);
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

function normalizeNotifyEmail(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const email = cleanText(value, "notifyEmail", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new SourceRegistryError("notifyEmail must be a valid email address.");
  }
  return email;
}

function normalizeContributors(
  value: unknown,
): SourceContributor[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new SourceRegistryError("contributors must be an array.");
  }
  if (value.length === 0) return undefined;
  if (value.length > 4) {
    throw new SourceRegistryError(
      "contributors can include at most 4 wallets.",
    );
  }
  const contributors = value.map((item, index) => {
    if (!isRecord(item)) {
      throw new SourceRegistryError(
        `contributors[${index}] must be an object.`,
      );
    }
    const wallet = normalizeWallet(item.wallet);
    const shareBps = Number(item.shareBps);
    if (!Number.isInteger(shareBps) || shareBps < 1 || shareBps > 10_000) {
      throw new SourceRegistryError(
        `contributors[${index}].shareBps must be an integer from 1 to 10000.`,
      );
    }
    return { wallet, shareBps };
  });
  const total = contributors.reduce(
    (sum, contributor) => sum + contributor.shareBps,
    0,
  );
  if (total !== 10_000) {
    throw new SourceRegistryError("contributors shareBps must sum to 10000.");
  }
  return contributors;
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
    Number.isInteger(source.priceAtomicUsdc) &&
    (source.sourceKind === "external" ||
      source.sourceKind === "seed" ||
      source.sourceKind === "internal-test") &&
    (source.creatorKind === "external" ||
      source.creatorKind === "seed" ||
      source.creatorKind === "internal-test") &&
    typeof source.verifiedCreator === "boolean"
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

  const wallet = normalizeOptionalWallet(registration.wallet);
  if (!wallet) {
    throw new SourceRegistryError("wallet must be a 20-byte EVM address.");
  }
  const custody = registration.custody;
  if (custody !== undefined && custody !== "self" && custody !== "circle-w3s") {
    throw new SourceRegistryError("custody must be self or circle-w3s.");
  }
  const origin = registration.origin;
  if (
    origin !== undefined &&
    origin !== "registered" &&
    origin !== "discovered" &&
    origin !== "rss-import"
  ) {
    throw new SourceRegistryError(
      "origin must be registered, discovered, or rss-import.",
    );
  }

  return {
    id: sourceId,
    title,
    creator,
    handle: normalizeHandle(registration.handle),
    wallet,
    url: normalizeUrl(registration.url),
    summary: cleanText(registration.summary, "summary", 340),
    tags: normalizeTags(registration.tags),
    priceAtomicUsdc: normalizePrice(registration.priceAtomicUsdc),
    sourceKind: "external",
    creatorKind: "external",
    verifiedCreator: false,
    custody: custody ?? "self",
    ...(registration.walletId
      ? { walletId: cleanText(registration.walletId, "walletId", 96) }
      : {}),
    probation: true,
    registeredAt: new Date().toISOString(),
    ...(normalizeNotifyEmail(registration.notifyEmail)
      ? { notifyEmail: normalizeNotifyEmail(registration.notifyEmail) }
      : {}),
    ...(normalizeContributors(registration.contributors)
      ? { contributors: normalizeContributors(registration.contributors) }
      : {}),
    origin: origin ?? "registered",
  };
}

type MintWallet = (args: {
  walletSetId: string;
  blockchain?: string;
  refId?: string;
}) => Promise<MintedWallet>;

async function inputWithCustodialWallet(
  input: unknown,
  mintWallet: MintWallet,
): Promise<unknown> {
  if (!isRecord(input)) return input;
  const wallet =
    typeof input.wallet === "string" ? input.wallet.trim() : input.wallet;
  if (wallet) return input;
  const walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (
    !process.env.CIRCLE_API_KEY ||
    !process.env.CIRCLE_ENTITY_SECRET ||
    !walletSetId
  ) {
    throw new SourceRegistryError("custodial onboarding not enabled.");
  }
  const title = typeof input.title === "string" ? input.title.trim() : "source";
  const minted = await mintWallet({
    walletSetId,
    blockchain: W3S_BLOCKCHAIN,
    refId: `source-${slugify(title)}`,
  });
  return {
    ...input,
    wallet: minted.address,
    custody: "circle-w3s",
    walletId: minted.id,
  };
}

export function buildSourceOwnershipMessage({
  sourceUrl,
  wallet,
  timestamp,
}: {
  sourceUrl: string;
  wallet: `0x${string}`;
  timestamp: string;
}): string {
  return [
    "Tollgate source ownership",
    `sourceUrl:${sourceUrl}`,
    `wallet:${wallet}`,
    `timestamp:${timestamp}`,
  ].join("\n");
}

async function ownershipProofFromInput(
  input: unknown,
  source: CreatorSource,
): Promise<SourceOwnershipProof | undefined> {
  if (!isRecord(input)) return undefined;
  const signature = input.ownershipSignature;
  const timestamp = input.ownershipTimestamp;
  if (signature === undefined && timestamp === undefined) return undefined;
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new SourceRegistryError("ownershipSignature must be a hex string.");
  }
  if (typeof timestamp !== "string" || timestamp.trim().length === 0) {
    throw new SourceRegistryError("ownershipTimestamp is required.");
  }

  // URL normalization (new URL().toString()) appends a trailing slash to
  // bare-domain URLs, so a creator who signs the URL they submitted would
  // otherwise fail verification. Accept a signature over either the normalized
  // stored URL or the raw submitted URL.
  const rawUrl =
    typeof input.url === "string"
      ? input.url.replace(/\s+/g, " ").trim()
      : source.url;
  const candidateUrls = Array.from(new Set([source.url, rawUrl]));
  let valid = false;
  for (const sourceUrl of candidateUrls) {
    const message = buildSourceOwnershipMessage({
      sourceUrl,
      wallet: source.wallet,
      timestamp: timestamp.trim(),
    });
    if (
      await verifyMessage({
        address: source.wallet,
        message,
        signature: signature as `0x${string}`,
      })
    ) {
      valid = true;
      break;
    }
  }
  if (!valid) {
    throw new SourceRegistryError(
      "ownershipSignature did not recover the source wallet.",
      401,
    );
  }

  return {
    method: "wallet-signature",
    signer: source.wallet,
    signatureHash: sha256Hex(signature),
    verifiedAt: new Date().toISOString(),
  };
}

async function readCustomSources(
  filePath: string = SOURCE_REGISTRY_PATH,
): Promise<CreatorSource[]> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCreatorSource);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw error;
  }
}

async function writeCustomSources(
  sources: CreatorSource[],
  filePath: string = SOURCE_REGISTRY_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function normalizedUrlKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.hostname.toLowerCase()}${pathname.toLowerCase()}`;
}

function sourceTitleKey(value: string): string {
  return slugify(value);
}

function registrationCapPerWalletPerDay(): number {
  const raw = Number(process.env.TOLLGATE_REGISTRATION_CAP_PER_WALLET_PER_DAY);
  return Number.isInteger(raw) && raw > 0
    ? raw
    : DEFAULT_REGISTRATION_CAP_PER_WALLET_PER_DAY;
}

function sameUtcDay(a: string | undefined, b: string): boolean {
  if (!a) return false;
  return a.slice(0, 10) === b.slice(0, 10);
}

function assertWalletRegistrationCap(
  existingSources: CreatorSource[],
  source: CreatorSource,
): void {
  const cap = registrationCapPerWalletPerDay();
  const registrationsToday = existingSources.filter(
    (existing) =>
      existing.sourceKind === "external" &&
      existing.wallet.toLowerCase() === source.wallet.toLowerCase() &&
      sameUtcDay(existing.registeredAt, source.registeredAt ?? ""),
  ).length;
  if (registrationsToday >= cap) {
    throw new SourceRegistryError(
      `wallet registration cap reached (${cap}/day).`,
      429,
    );
  }
}

function assertNoDuplicateSource(
  existingSources: CreatorSource[],
  source: CreatorSource,
): void {
  const nextUrlKey = normalizedUrlKey(source.url);
  const nextTitleKey = sourceTitleKey(source.title);
  for (const existing of existingSources) {
    if (normalizedUrlKey(existing.url) === nextUrlKey) {
      throw new SourceRegistryError("source url already exists.", 409);
    }
    if (sourceTitleKey(existing.title) === nextTitleKey) {
      throw new SourceRegistryError("source title already exists.", 409);
    }
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readCappedResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return (await response.text()).slice(0, maxBytes);

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;
  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      const remainingBytes = maxBytes - totalBytes;
      if (value.byteLength > remainingBytes) {
        chunks.push(value.slice(0, remainingBytes));
        totalBytes += remainingBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
      if (totalBytes >= maxBytes) {
        truncated = true;
        break;
      }
    }
  } finally {
    if (truncated) {
      await reader.cancel().catch(() => undefined);
    } else {
      reader.releaseLock();
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function fetchSourceContentExcerpt(
  sourceUrl: URL | string,
  init: RequestInit = {},
): Promise<
  Pick<CreatorSource, "contentHash" | "contentFetchedAt" | "contentExcerpt">
> {
  const url = sourceUrl instanceof URL ? sourceUrl : new URL(sourceUrl);
  const response = await safeFetch(url, init);
  if (!response.ok) return {};
  const contentType = response.headers.get("content-type") ?? "";
  if (!SOURCE_CONTENT_TYPE_PATTERN.test(contentType)) return {};
  const text = await readCappedResponseText(response, SOURCE_CONTENT_MAX_BYTES);
  const contentExcerpt = htmlToText(text).slice(
    0,
    SOURCE_CONTENT_EXCERPT_MAX_CHARS,
  );
  return {
    contentHash: sha256Hex({
      url: url.toString(),
      body: text.slice(0, SOURCE_CONTENT_MAX_BYTES),
    }),
    contentFetchedAt: new Date().toISOString(),
    ...(contentExcerpt.trim() ? { contentExcerpt } : {}),
  };
}

async function registrationContentEvidence(
  source: CreatorSource,
): Promise<
  Pick<CreatorSource, "contentHash" | "contentFetchedAt" | "contentExcerpt">
> {
  if (process.env.TOLLGATE_REGISTRATION_FETCH === "0") return {};
  const url = new URL(source.url);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REGISTRATION_FETCH_TIMEOUT_MS,
  );
  try {
    return await fetchSourceContentExcerpt(url, { signal: controller.signal });
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

export type RefetchSourceContentResult = {
  updated: number;
  skipped: number;
  failed: number;
  failures: { id: string; url: string; error: string }[];
};

function shouldRefreshSourceContent(
  source: CreatorSource,
  refreshAll: boolean,
): boolean {
  if (source.sourceKind === "seed") return false;
  if (!refreshAll && source.contentExcerpt?.trim()) return false;
  try {
    const url = new URL(source.url);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function refetchCustomSourceContent({
  filePath = SOURCE_REGISTRY_PATH,
  refreshAll = false,
}: {
  filePath?: string;
  refreshAll?: boolean;
} = {}): Promise<RefetchSourceContentResult> {
  return withRegistryLock(async () => {
    const customSources = await readCustomSources(filePath);
    const nextCustomSources = customSources.slice();
    const result: RefetchSourceContentResult = {
      updated: 0,
      skipped: 0,
      failed: 0,
      failures: [],
    };

    for (const [index, source] of customSources.entries()) {
      if (!shouldRefreshSourceContent(source, refreshAll)) {
        result.skipped += 1;
        continue;
      }
      try {
        const contentEvidence = await fetchSourceContentExcerpt(source.url);
        if (!contentEvidence.contentExcerpt?.trim()) {
          result.skipped += 1;
          continue;
        }
        nextCustomSources[index] = {
          ...source,
          ...contentEvidence,
        };
        result.updated += 1;
      } catch (error) {
        result.failed += 1;
        result.failures.push({
          id: source.id,
          url: source.url,
          error:
            error instanceof Error ? error.message : "content fetch failed",
        });
      }
    }

    if (result.updated > 0) {
      await writeCustomSources(nextCustomSources, filePath);
    }
    return result;
  });
}

export function publicSource(source: CreatorSource): CreatorSource {
  // Strip creator PII / custodial internals before a source leaves the
  // server: notifyEmail and the Circle W3S walletId are operator-only.
  const { notifyEmail: _notifyEmail, walletId: _walletId, ...rest } = source;
  return rest;
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

let registryWriteChain: Promise<unknown> = Promise.resolve();

function withRegistryLock<T>(task: () => Promise<T>): Promise<T> {
  const run = registryWriteChain.then(task, task);
  registryWriteChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function appendSource(
  input: unknown,
  filePath: string = SOURCE_REGISTRY_PATH,
  mintWallet: MintWallet = w3sMintWallet,
): Promise<{ source: CreatorSource; sources: CreatorSource[] }> {
  const registrationInput = await inputWithCustodialWallet(input, mintWallet);
  const normalized = normalizeSourceInput(registrationInput);
  const ownershipProof = await ownershipProofFromInput(
    registrationInput,
    normalized,
  );
  const contentEvidence = await registrationContentEvidence(normalized);
  const source: CreatorSource = {
    ...normalized,
    verifiedCreator: false,
    probation: true,
    ...(ownershipProof ? { ownershipProof } : {}),
    ...contentEvidence,
  };
  const liveSources = await readRsshubSources();
  return withRegistryLock(async () => {
    const customSources = await readCustomSources(filePath);
    const seen = new Set<string>();
    const existingSources = [
      ...liveSources,
      ...DEFAULT_CREATOR_SOURCES,
      ...customSources,
    ].filter((existing) => {
      if (seen.has(existing.id)) return false;
      seen.add(existing.id);
      return true;
    });
    if (existingSources.some((existing) => existing.id === source.id)) {
      throw new SourceRegistryError("source id already exists.", 409);
    }
    assertNoDuplicateSource(existingSources, source);
    assertWalletRegistrationCap(existingSources, source);
    const nextCustomSources = [...customSources, source];
    await writeCustomSources(nextCustomSources, filePath);
    return { source, sources: [...existingSources, source] };
  });
}

export async function updateSourceVerification(
  sourceId: string,
  ownershipProof: SourceOwnershipProof,
  filePath: string = SOURCE_REGISTRY_PATH,
): Promise<{ source: CreatorSource; sources: CreatorSource[] }> {
  return withRegistryLock(async () => {
    const customSources = await readCustomSources(filePath);
    const index = customSources.findIndex((source) => source.id === sourceId);
    if (index < 0) {
      throw new SourceRegistryError("source not found.", 404);
    }
    const domainVerified =
      ownershipProof.method === "meta-tag" ||
      ownershipProof.method === "dns-txt";
    const source: CreatorSource = {
      ...customSources[index],
      ...(domainVerified ? { verifiedCreator: true, probation: false } : {}),
      ownershipProof,
    };
    const nextCustomSources = customSources.slice();
    nextCustomSources[index] = source;
    await writeCustomSources(nextCustomSources, filePath);
    const liveSources = await readRsshubSources();
    return {
      source,
      sources: [
        ...liveSources,
        ...DEFAULT_CREATOR_SOURCES,
        ...nextCustomSources,
      ],
    };
  });
}

export async function claimSourceAsCreator(
  sourceId: string,
  input: unknown,
  filePath: string = SOURCE_REGISTRY_PATH,
): Promise<{ source: CreatorSource; sources: CreatorSource[] }> {
  if (!isRecord(input) || input.attest !== true) {
    throw new SourceRegistryError(
      "creator claim requires an explicit attestation.",
    );
  }

  return withRegistryLock(async () => {
    const customSources = await readCustomSources(filePath);
    const index = customSources.findIndex((source) => source.id === sourceId);
    if (index < 0) {
      throw new SourceRegistryError("source not found.", 404);
    }
    const source: CreatorSource = {
      ...customSources[index],
      creatorClaimed: true,
      probation: false,
      ownershipProof: {
        method: "creator-claimed",
        verifiedAt: new Date().toISOString(),
      },
    };
    const nextCustomSources = customSources.slice();
    nextCustomSources[index] = source;
    await writeCustomSources(nextCustomSources, filePath);
    const liveSources = await readRsshubSources();
    return {
      source,
      sources: [
        ...liveSources,
        ...DEFAULT_CREATOR_SOURCES,
        ...nextCustomSources,
      ],
    };
  });
}

export async function verifySourceOwnership(
  sourceId: string,
  input: unknown,
  filePath: string = SOURCE_REGISTRY_PATH,
): Promise<{ source: CreatorSource; sources: CreatorSource[] }> {
  const customSources = await readCustomSources(filePath);
  const source = customSources.find((candidate) => candidate.id === sourceId);
  if (!source) {
    throw new SourceRegistryError("source not found.", 404);
  }
  const ownershipProof = await ownershipProofFromInput(input, source);
  if (!ownershipProof) {
    throw new SourceRegistryError("ownershipSignature is required.");
  }
  return updateSourceVerification(sourceId, ownershipProof, filePath);
}

export async function findSource(
  sourceId: string,
): Promise<CreatorSource | undefined> {
  const sources = await readSources();
  return sources.find((source) => source.id === sourceId);
}
