import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import type { WalletRegistry, WalletRegistryEntry } from "./types";

const REGISTRY_PATH = path.join(process.cwd(), "data", "registry.json");
const EMPTY_REGISTRY: WalletRegistry = { photographers: [] };

function isRegistryEntry(value: unknown): value is WalletRegistryEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.ownerId === "string" &&
    typeof record.displayName === "string" &&
    typeof record.wallet === "string" &&
    isAddress(record.wallet) &&
    typeof record.createdAt === "string"
  );
}

function normalizeEntry(entry: WalletRegistryEntry): WalletRegistryEntry {
  return { ...entry, wallet: getAddress(entry.wallet) };
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
