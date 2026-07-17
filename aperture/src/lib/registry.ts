import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { redactPublicText } from "./public-data";
import type { WalletRegistry, WalletRegistryEntry } from "./types";

const REGISTRY_PATH = path.join(process.cwd(), "data", "registry.json");
const EMPTY_REGISTRY: WalletRegistry = { photographers: [] };
let registryWriteLock: Promise<void> = Promise.resolve();
const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export type PublicWalletRegistryEntry = Pick<
  WalletRegistryEntry,
  | "ownerId"
  | "displayName"
  | "wallet"
  | "createdAt"
  | "approvalStatus"
  | "custody"
>;

function isHexHash(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{64}$/.test(value);
}

function isLinkedWallets(value: unknown): value is string[] {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.every(
        (wallet) => typeof wallet === "string" && WALLET_PATTERN.test(wallet),
      ))
  );
}

export function withRegistryWriteLock<T>(write: () => Promise<T>): Promise<T> {
  const run = registryWriteLock.then(write, write);
  registryWriteLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isRegistryEntry(value: unknown): value is WalletRegistryEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ownerId === "string" &&
    typeof record.displayName === "string" &&
    typeof record.wallet === "string" &&
    isAddress(record.wallet) &&
    typeof record.createdAt === "string" &&
    (record.approvalStatus === undefined ||
      record.approvalStatus === "pending" ||
      record.approvalStatus === "operator-approved" ||
      record.approvalStatus === "wallet-signed") &&
    (record.accountKeyHash === undefined || isHexHash(record.accountKeyHash)) &&
    (record.email === undefined || typeof record.email === "string") &&
    (record.loginTokenHash === undefined || isHexHash(record.loginTokenHash)) &&
    (record.loginTokenExpiresAt === undefined ||
      typeof record.loginTokenExpiresAt === "string") &&
    isLinkedWallets(record.linkedWallets)
  );
}

function normalizeEntry(entry: WalletRegistryEntry): WalletRegistryEntry {
  const linkedWallets = Array.from(
    new Set((entry.linkedWallets ?? []).map((wallet) => wallet.toLowerCase())),
  );
  return {
    ...entry,
    wallet: getAddress(entry.wallet),
    ...(linkedWallets.length > 0 ? { linkedWallets } : {}),
    approvalStatus: entry.approvalStatus ?? "operator-approved",
  };
}

function parseRegistry(value: unknown): WalletRegistry {
  if (!value || typeof value !== "object") return EMPTY_REGISTRY;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.photographers)) return EMPTY_REGISTRY;
  return {
    photographers: record.photographers
      .filter(isRegistryEntry)
      .map(normalizeEntry),
  };
}

export async function readWalletRegistry(
  filePath: string = REGISTRY_PATH,
): Promise<WalletRegistry> {
  try {
    return parseRegistry(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_REGISTRY;
    throw error;
  }
}

export async function writeWalletRegistry(
  registry: WalletRegistry,
  filePath: string = REGISTRY_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export function findWalletForOwner(
  registry: WalletRegistry,
  ownerId: string,
): WalletRegistryEntry | null {
  return (
    registry.photographers.find((entry) => entry.ownerId === ownerId) ?? null
  );
}

export async function readWalletForOwner(
  ownerId: string,
  filePath: string = REGISTRY_PATH,
): Promise<WalletRegistryEntry | null> {
  return findWalletForOwner(await readWalletRegistry(filePath), ownerId);
}

export function publicWalletRegistryEntry(
  entry: WalletRegistryEntry,
): PublicWalletRegistryEntry {
  return {
    ownerId: redactPublicText(entry.ownerId),
    displayName: redactPublicText(entry.displayName),
    wallet: entry.wallet,
    createdAt: entry.createdAt,
    approvalStatus: entry.approvalStatus,
    ...(entry.custody ? { custody: entry.custody } : {}),
  };
}

export function upsertWalletRegistryEntry(
  registry: WalletRegistry,
  entry: WalletRegistryEntry,
): WalletRegistry {
  const normalized = normalizeEntry(entry);
  return {
    photographers: [
      normalized,
      ...registry.photographers.filter(
        (candidate) => candidate.ownerId !== entry.ownerId,
      ),
    ],
  };
}
