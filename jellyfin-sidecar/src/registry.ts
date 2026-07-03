import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  Address,
  CreatorRegistry,
  CreatorRegistryEntry,
} from "./types.js";

const EMPTY_REGISTRY: CreatorRegistry = { videos: [] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isAddressString(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function readString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function parseRegistryEntry(value: unknown): CreatorRegistryEntry | null {
  if (!isRecord(value)) return null;
  const itemId = readString(value, "itemId") ?? readString(value, "videoId");
  const displayName =
    readString(value, "displayName") ?? readString(value, "creator");
  const wallet = value.wallet;

  if (!itemId || !displayName || !isAddressString(wallet)) return null;
  if (
    value.approvalStatus !== undefined &&
    value.approvalStatus !== "pending" &&
    value.approvalStatus !== "operator-approved" &&
    value.approvalStatus !== "wallet-signed"
  ) {
    return null;
  }

  const price = value.priceAtomicUsdcPerMinute;
  return {
    itemId,
    itemIds: readStringArray(value, "itemIds"),
    title: readString(value, "title") ?? undefined,
    displayName,
    wallet,
    priceAtomicUsdcPerMinute:
      typeof price === "number" && Number.isInteger(price) && price > 0
        ? price
        : undefined,
    approvalStatus: value.approvalStatus,
  };
}

function parseRegistry(value: unknown): CreatorRegistry {
  if (!isRecord(value)) return EMPTY_REGISTRY;
  const entries = value.videos ?? value.items ?? value.creators;
  if (!Array.isArray(entries)) return EMPTY_REGISTRY;
  return {
    videos: entries
      .map(parseRegistryEntry)
      .filter((entry): entry is CreatorRegistryEntry => entry !== null),
  };
}

export async function readCreatorRegistry(
  filePath: string,
): Promise<CreatorRegistry> {
  try {
    return parseRegistry(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_REGISTRY;
    throw error;
  }
}

export async function writeCreatorRegistry(
  registry: CreatorRegistry,
  filePath: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export function findCreatorForItem(
  registry: CreatorRegistry,
  itemId: string,
): CreatorRegistryEntry | null {
  return (
    registry.videos.find(
      (entry) =>
        entry.itemId === itemId ||
        entry.itemIds?.some((candidate) => candidate === itemId),
    ) ?? null
  );
}
