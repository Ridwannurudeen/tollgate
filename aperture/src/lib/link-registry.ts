import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { APERTURE_LICENSE_FEE_ATOMIC_USDC } from "./config";

const LINKS_PATH = path.join(process.cwd(), "data", "links.json");
const EMPTY_LINKS: LinkRegistry = { links: [] };
let linkWriteLock: Promise<void> = Promise.resolve();

export type LinkRecord = {
  id: string;
  title: string;
  ownerId: string;
  sourceUrl: string;
  contentType?: string;
  sourceContentHash?: `0x${string}`;
  priceAtomicUsdc: number;
  createdAt: string;
};

export type PublicLinkRecord = Omit<
  LinkRecord,
  "sourceUrl" | "sourceContentHash"
>;

export type LinkRegistry = {
  links: LinkRecord[];
};

export type RegisterLinkInput = {
  id?: string;
  title: string;
  ownerId: string;
  sourceUrl: string;
  contentType?: string;
  sourceContentHash?: `0x${string}`;
  priceAtomicUsdc?: number;
  createdAt?: string;
};

export class LinkRegistryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function isHexHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isLinkRecord(value: unknown): value is LinkRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.ownerId === "string" &&
    typeof record.sourceUrl === "string" &&
    typeof record.priceAtomicUsdc === "number" &&
    Number.isFinite(record.priceAtomicUsdc) &&
    typeof record.createdAt === "string" &&
    (record.contentType === undefined ||
      typeof record.contentType === "string") &&
    (record.sourceContentHash === undefined ||
      isHexHash(record.sourceContentHash))
  );
}

function parseLinks(value: unknown): LinkRegistry {
  if (!value || typeof value !== "object") return EMPTY_LINKS;
  const links = (value as Record<string, unknown>).links;
  if (!Array.isArray(links)) return EMPTY_LINKS;
  return { links: links.filter(isLinkRecord) };
}

export function normalizedSourceUrlKey(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LinkRegistryError("photo URL must use http or https.");
  }
  url.hash = "";
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "https:" && url.port === "443") ||
    (url.protocol === "http:" && url.port === "80")
  ) {
    url.port = "";
  }
  return url.toString();
}

export async function readLinks(
  filePath: string = LINKS_PATH,
): Promise<LinkRegistry> {
  try {
    return parseLinks(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_LINKS;
    throw error;
  }
}

export async function writeLinks(
  registry: LinkRegistry,
  filePath: string = LINKS_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function withLinkWriteLock<T>(write: () => Promise<T>): Promise<T> {
  const run = linkWriteLock.then(write, write);
  linkWriteLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function publicLink(link: LinkRecord): PublicLinkRecord {
  return {
    id: link.id,
    title: link.title,
    ownerId: link.ownerId,
    ...(link.contentType ? { contentType: link.contentType } : {}),
    priceAtomicUsdc: link.priceAtomicUsdc,
    createdAt: link.createdAt,
  };
}

export async function findLink(
  id: string,
  filePath: string = LINKS_PATH,
): Promise<LinkRecord | null> {
  const registry = await readLinks(filePath);
  return registry.links.find((link) => link.id === id) ?? null;
}

export async function findLinkBySourceUrl(
  sourceUrl: string,
  filePath: string = LINKS_PATH,
): Promise<LinkRecord | null> {
  const key = normalizedSourceUrlKey(sourceUrl);
  const registry = await readLinks(filePath);
  return (
    registry.links.find(
      (link) => normalizedSourceUrlKey(link.sourceUrl) === key,
    ) ?? null
  );
}

export async function registerLink(
  input: RegisterLinkInput,
  filePath: string = LINKS_PATH,
): Promise<LinkRecord> {
  const title = input.title.trim();
  const ownerId = input.ownerId.trim();
  if (!title || !ownerId) {
    throw new LinkRegistryError("title and ownerId are required.");
  }
  const sourceUrl = normalizedSourceUrlKey(input.sourceUrl);
  return withLinkWriteLock(async () => {
    const registry = await readLinks(filePath);
    if (
      registry.links.some(
        (link) => normalizedSourceUrlKey(link.sourceUrl) === sourceUrl,
      )
    ) {
      throw new LinkRegistryError("photo URL already registered.", 409);
    }
    const record: LinkRecord = {
      id: input.id ?? randomUUID(),
      title,
      ownerId,
      sourceUrl,
      ...(input.contentType ? { contentType: input.contentType } : {}),
      ...(input.sourceContentHash
        ? { sourceContentHash: input.sourceContentHash }
        : {}),
      priceAtomicUsdc:
        input.priceAtomicUsdc ?? APERTURE_LICENSE_FEE_ATOMIC_USDC,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    await writeLinks({ links: [record, ...registry.links] }, filePath);
    return record;
  });
}
