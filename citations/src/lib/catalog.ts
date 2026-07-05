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
];

const SOURCE_REGISTRY_PATH = path.join(process.cwd(), "data", "sources.json");
const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const REGISTRATION_FETCH_TIMEOUT_MS = 5_000;
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

async function registrationContentEvidence(
  source: CreatorSource,
): Promise<Pick<CreatorSource, "contentHash" | "contentFetchedAt">> {
  if (process.env.TOLLGATE_REGISTRATION_FETCH === "0") return {};
  const url = new URL(source.url);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REGISTRATION_FETCH_TIMEOUT_MS,
  );
  try {
    const response = await safeFetch(url, { signal: controller.signal });
    if (!response.ok) return {};
    const contentType = response.headers.get("content-type") ?? "";
    if (
      !/(text\/html|application\/xhtml\+xml|application\/rss\+xml|application\/atom\+xml|text\/xml|application\/xml)/i.test(
        contentType,
      )
    ) {
      return {};
    }
    const text = await response.text();
    return {
      contentHash: sha256Hex({
        url: url.toString(),
        body: text.slice(0, 200_000),
      }),
      contentFetchedAt: new Date().toISOString(),
    };
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
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
    verifiedCreator: ownershipProof !== undefined,
    probation: ownershipProof === undefined,
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
    const source: CreatorSource = {
      ...customSources[index],
      verifiedCreator: true,
      probation: false,
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
