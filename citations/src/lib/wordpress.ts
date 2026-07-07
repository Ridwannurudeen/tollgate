import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Address } from "viem";
import {
  appendSettlement,
  readLedger,
  verifyLedgerIntegrity,
} from "./ledger";
import { routeCitationPayments, type FeeRouterRouteOptions } from "./fee-router";
import { sha256Hex } from "./hash";
import type {
  Citation,
  Ledger,
  PaymentReceipt,
  QueryRecord,
} from "./types";

const WORDPRESS_SITES_PATH = path.join(
  process.cwd(),
  "data",
  "wordpress-sites.json",
);
const EMPTY_WORDPRESS_SITES: WordPressSiteRegistry = { sites: [] };
const MAX_POST_ID_LENGTH = 120;
const MAX_TITLE_LENGTH = 180;
const MAX_FINGERPRINT_LENGTH = 240;
let wordpressRegistryLock: Promise<void> = Promise.resolve();

export type WordPressSite = {
  id: string;
  siteUrl: string;
  creatorWallet: Address;
  apiKeyHash: `0x${string}`;
  registeredAt: string;
};

export type WordPressSiteRegistry = {
  sites: WordPressSite[];
};

export type WordPressPostAccessInput = {
  postId: string;
  priceAtomicUsdc: number;
  requesterFingerprint?: string;
  title?: string;
  postUrl?: string;
};

export type WordPressPostStatus = {
  paid: boolean;
  eventId: string;
  receipt: PaymentReceipt | null;
};

export type WordPressSettlementDeps = {
  readLedger?: typeof readLedger;
  appendSettlement?: typeof appendSettlement;
  routeCitationPayments?: typeof routeCitationPayments;
  ledgerPath?: string;
  feeRouterOptions?: FeeRouterRouteOptions;
  now?: () => Date;
};

export class WordPressRegistryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function isAddress(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isSiteRecord(value: unknown): value is WordPressSite {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.siteUrl === "string" &&
    isAddress(record.creatorWallet) &&
    typeof record.apiKeyHash === "string" &&
    /^0x[a-fA-F0-9]{64}$/.test(record.apiKeyHash) &&
    typeof record.registeredAt === "string"
  );
}

function parseWordPressSites(value: unknown): WordPressSiteRegistry {
  if (!value || typeof value !== "object") return EMPTY_WORDPRESS_SITES;
  const sites = (value as Record<string, unknown>).sites;
  return Array.isArray(sites)
    ? { sites: sites.filter(isSiteRecord) }
    : EMPTY_WORDPRESS_SITES;
}

export async function readWordPressSites(
  filePath: string = WORDPRESS_SITES_PATH,
): Promise<WordPressSiteRegistry> {
  try {
    return parseWordPressSites(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_WORDPRESS_SITES;
    throw error;
  }
}

export async function writeWordPressSites(
  registry: WordPressSiteRegistry,
  filePath: string = WORDPRESS_SITES_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function withWordPressRegistryLock<T>(write: () => Promise<T>): Promise<T> {
  const run = wordpressRegistryLock.then(write, write);
  wordpressRegistryLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function normalizeSiteUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WordPressRegistryError("siteUrl is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new WordPressRegistryError("siteUrl must be a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WordPressRegistryError("siteUrl must use http or https.");
  }
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

function siteId(siteUrl: string): string {
  return `wp_${sha256Hex({ type: "wordpress-site", siteUrl }).slice(2, 14)}`;
}

function normalizeApiKeySeed(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 8) {
    throw new WordPressRegistryError("apiKeySeed must be at least 8 characters.");
  }
  return value.trim();
}

function siteKeyHash(siteKey: string): `0x${string}` {
  return sha256Hex(siteKey.trim()) as `0x${string}`;
}

function timingSafeHashEquals(left: string, right: string): boolean {
  if (!/^0x[a-fA-F0-9]{64}$/.test(left) || !/^0x[a-fA-F0-9]{64}$/.test(right)) {
    return false;
  }
  const leftBuffer = Buffer.from(left.slice(2), "hex");
  const rightBuffer = Buffer.from(right.slice(2), "hex");
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function generateWordPressSiteKey(
  id: string,
  apiKeySeed: string,
  nonce = randomBytes(32).toString("hex"),
): string {
  return `tgwp_${sha256Hex({
    type: "wordpress-site-key",
    id,
    apiKeySeed,
    nonce,
  }).slice(2)}`;
}

export async function registerWordPressSite(
  input: unknown,
  filePath: string = WORDPRESS_SITES_PATH,
  now = new Date(),
): Promise<{ site: Omit<WordPressSite, "apiKeyHash">; apiKey: string }> {
  if (!input || typeof input !== "object") {
    throw new WordPressRegistryError("Request body must be a JSON object.");
  }
  const body = input as Record<string, unknown>;
  const siteUrl = normalizeSiteUrl(body.siteUrl);
  const creatorWallet = body.creatorWallet;
  if (!isAddress(creatorWallet)) {
    throw new WordPressRegistryError("creatorWallet must be a valid 0x address.");
  }
  const id = siteId(siteUrl);
  const apiKey = generateWordPressSiteKey(
    id,
    normalizeApiKeySeed(body.apiKeySeed),
  );
  const record: WordPressSite = {
    id,
    siteUrl,
    creatorWallet,
    apiKeyHash: siteKeyHash(apiKey),
    registeredAt: now.toISOString(),
  };
  await withWordPressRegistryLock(async () => {
    const registry = await readWordPressSites(filePath);
    await writeWordPressSites(
      {
        sites: [record, ...registry.sites.filter((site) => site.id !== id)],
      },
      filePath,
    );
  });
  const publicSite = {
    id: record.id,
    siteUrl: record.siteUrl,
    creatorWallet: record.creatorWallet,
    registeredAt: record.registeredAt,
  };
  return { site: publicSite, apiKey };
}

export async function authenticateWordPressSite(
  apiKey: string | null,
  filePath: string = WORDPRESS_SITES_PATH,
): Promise<WordPressSite | null> {
  const trimmed = apiKey?.trim();
  if (!trimmed) return null;
  const suppliedHash = siteKeyHash(trimmed);
  const registry = await readWordPressSites(filePath);
  return (
    registry.sites.find((site) =>
      timingSafeHashEquals(suppliedHash, site.apiKeyHash),
    ) ?? null
  );
}

function postId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WordPressRegistryError("postId is required.");
  }
  const trimmed = value.trim();
  if (
    trimmed.length > MAX_POST_ID_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/.test(trimmed)
  ) {
    throw new WordPressRegistryError("postId is invalid.");
  }
  return trimmed;
}

function priceAtomicUsdc(value: unknown): number {
  const price = typeof value === "string" ? Number(value) : value;
  if (
    typeof price !== "number" ||
    !Number.isInteger(price) ||
    price <= 0 ||
    price > 1_000_000_000
  ) {
    throw new WordPressRegistryError(
      "priceAtomicUsdc must be a positive integer.",
    );
  }
  return price;
}

function optionalText(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

function postUrl(site: WordPressSite, postIdValue: string, value: unknown): string {
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = new URL(value.trim());
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        parsed.hash = "";
        return parsed.toString();
      }
    } catch {
      // Fall through to the canonical WordPress query URL.
    }
  }
  const fallback = new URL(site.siteUrl);
  fallback.searchParams.set("p", postIdValue);
  return fallback.toString();
}

function requesterFingerprint(value: unknown): string {
  const raw = optionalText(value, MAX_FINGERPRINT_LENGTH) ?? "anonymous";
  return sha256Hex({ type: "wordpress-requester", raw }).slice(2, 18);
}

export function normalizeWordPressAccessInput(
  site: WordPressSite,
  postIdValue: string,
  body: unknown,
): WordPressPostAccessInput & { eventId: string; sourceId: string } {
  if (!body || typeof body !== "object") {
    throw new WordPressRegistryError("Request body must be a JSON object.");
  }
  const record = body as Record<string, unknown>;
  const normalizedPostId = postId(postIdValue);
  const fingerprint = requesterFingerprint(record.requesterFingerprint);
  return {
    postId: normalizedPostId,
    priceAtomicUsdc: priceAtomicUsdc(record.priceAtomicUsdc),
    requesterFingerprint: fingerprint,
    title: optionalText(record.title, MAX_TITLE_LENGTH),
    postUrl: postUrl(site, normalizedPostId, record.postUrl),
    eventId: `wordpress:${site.id}:${normalizedPostId}:${fingerprint}`,
    sourceId: `wordpress:${site.id}:${normalizedPostId}`,
  };
}

function creatorLabel(site: WordPressSite): string {
  return new URL(site.siteUrl).hostname;
}

export function buildWordPressAccessRecord(
  site: WordPressSite,
  input: WordPressPostAccessInput & { eventId: string; sourceId: string },
  createdAt: string,
): QueryRecord {
  const title = input.title ?? `WordPress post ${input.postId}`;
  const creator = creatorLabel(site);
  const citation: Citation = {
    sourceId: input.sourceId,
    title,
    creator,
    handle: `@${creator}`,
    wallet: site.creatorWallet,
    url: input.postUrl ?? site.siteUrl,
    amountAtomicUsdc: input.priceAtomicUsdc,
    reason: "WordPress gated post access.",
    canonicalUrl: input.postUrl,
    sourceKind: "external",
    creatorKind: "external",
    verifiedCreator: false,
    creatorClaimed: true,
    ownershipProof: {
      method: "creator-claimed",
      verifiedAt: site.registeredAt,
    },
  };
  const question = `Paid WordPress access: ${site.siteUrl}#${input.postId}`;
  const answer = `Tollgate unlocked "${title}" for a WordPress reader and wrote the payment into the public attribution ledger.`;
  const queryHash = sha256Hex({
    eventId: input.eventId,
    question,
    citations: [citation],
  });
  const answerHash = sha256Hex({
    eventId: input.eventId,
    answer,
    citations: [citation],
  });

  return {
    id: input.eventId,
    question,
    answer,
    queryHash,
    answerHash,
    totalAtomicUsdc: input.priceAtomicUsdc,
    citations: [citation],
    agentMode: "deterministic",
    agentRationale:
      "WordPress plugin requested direct gated-post access through the hosted Tollgate settlement API.",
    receiptHashes: [],
    createdAt,
  };
}

function receiptForEvent(
  ledger: Ledger,
  eventId: string,
): PaymentReceipt | null {
  return ledger.receipts.find((receipt) => receipt.queryId === eventId) ?? null;
}

export async function wordpressPostStatus(
  site: WordPressSite,
  postIdValue: string,
  body: unknown,
  deps: Pick<WordPressSettlementDeps, "readLedger" | "ledgerPath"> = {},
): Promise<WordPressPostStatus> {
  const input = normalizeWordPressAccessInput(site, postIdValue, body);
  const ledger = await (deps.readLedger ?? readLedger)(deps.ledgerPath);
  const receipt = receiptForEvent(ledger, input.eventId);
  return { paid: Boolean(receipt), eventId: input.eventId, receipt };
}

export async function settleWordPressPost(
  site: WordPressSite,
  postIdValue: string,
  body: unknown,
  deps: WordPressSettlementDeps = {},
): Promise<{
  paid: true;
  created: boolean;
  eventId: string;
  query: QueryRecord;
  receipt: PaymentReceipt;
}> {
  const input = normalizeWordPressAccessInput(site, postIdValue, body);
  const read = deps.readLedger ?? readLedger;
  const ledger = await read(deps.ledgerPath);
  const existingReceipt = receiptForEvent(ledger, input.eventId);
  const existingQuery = ledger.queries.find((query) => query.id === input.eventId);
  if (existingReceipt && existingQuery) {
    return {
      paid: true,
      created: false,
      eventId: input.eventId,
      query: existingQuery,
      receipt: existingReceipt,
    };
  }

  const query = buildWordPressAccessRecord(
    site,
    input,
    (deps.now?.() ?? new Date()).toISOString(),
  );
  const feeRouterOptions = {
    ...(deps.feeRouterOptions ?? {}),
    tenantId: site.id,
  };
  const evidenceBySourceId = await (deps.routeCitationPayments ??
    routeCitationPayments)(query, feeRouterOptions);
  const settlement = await (deps.appendSettlement ?? appendSettlement)(
    query,
    evidenceBySourceId,
    deps.ledgerPath,
  );
  const receipt = settlement.receipts[0];
  if (!receipt) {
    throw new Error("WordPress settlement did not create a receipt.");
  }
  return {
    paid: true,
    created: true,
    eventId: input.eventId,
    query: settlement.query,
    receipt,
  };
}

export async function buildWordPressProof(
  ledgerReader: typeof readLedger = readLedger,
) {
  const ledger = await ledgerReader();
  const verification = verifyLedgerIntegrity(ledger);
  const queries = ledger.queries.filter((query) =>
    query.id.startsWith("wordpress:"),
  );
  const queryIds = new Set(queries.map((query) => query.id));
  const receipts = ledger.receipts.filter((receipt) =>
    queryIds.has(receipt.queryId),
  );
  return {
    project: "tollgate-wordpress",
    generatedAt: new Date().toISOString(),
    ledger: {
      valid: verification.ok,
      verification,
      latestHash: ledger.receipts.at(-1)?.receiptHash ?? null,
      wordpressReceiptCount: receipts.length,
    },
    receipts,
    queries,
  };
}
