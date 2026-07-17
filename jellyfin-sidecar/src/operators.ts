import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "./hash.js";
import {
  isAddressString,
  readCreatorRegistry,
  writeCreatorRegistry,
} from "./registry.js";
import type { Address, CreatorRegistryEntry, Hex } from "./types.js";

const EMPTY_OPERATORS: JellyfinOperatorRegistry = { operators: [] };
const MAX_TEXT_LENGTH = 160;
let operatorRegistryLock: Promise<void> = Promise.resolve();

export type JellyfinOperator = {
  id: string;
  operatorName: string;
  apiKeyHash: Hex;
  itemIds: string[];
  registeredAt: string;
};

export type JellyfinOperatorRegistry = {
  operators: JellyfinOperator[];
};

export type JellyfinOperatorRegistration = {
  operatorName: string;
  itemId: string;
  title?: string;
  displayName: string;
  wallet: Address;
  priceAtomicUsdcPerMinute?: number;
};

export class JellyfinOperatorRegistrationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredText(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new JellyfinOperatorRegistrationError(`${key} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new JellyfinOperatorRegistrationError(`${key} is too long.`);
  }
  return trimmed;
}

function readOptionalText(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new JellyfinOperatorRegistrationError(`${key} must be text.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new JellyfinOperatorRegistrationError(`${key} is too long.`);
  }
  return trimmed;
}

function readPriceAtomicUsdcPerMinute(
  value: unknown,
): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "string" ? Number(value) : value;
  if (
    typeof parsed !== "number" ||
    !Number.isInteger(parsed) ||
    parsed <= 0 ||
    parsed > 1_000_000_000
  ) {
    throw new JellyfinOperatorRegistrationError(
      "priceAtomicUsdcPerMinute must be a positive integer.",
    );
  }
  return parsed;
}

function normalizeItemId(itemId: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(itemId)) {
    throw new JellyfinOperatorRegistrationError("itemId is invalid.");
  }
  return itemId;
}

function parseOperator(value: unknown): JellyfinOperator | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const operatorName = value.operatorName;
  const apiKeyHash = value.apiKeyHash;
  const itemIds = value.itemIds;
  const registeredAt = value.registeredAt;
  if (
    typeof id !== "string" ||
    typeof operatorName !== "string" ||
    typeof apiKeyHash !== "string" ||
    !/^0x[a-fA-F0-9]{64}$/.test(apiKeyHash) ||
    !Array.isArray(itemIds) ||
    typeof registeredAt !== "string"
  ) {
    return null;
  }
  const normalizedItemIds = itemIds.filter(
    (itemId): itemId is string => typeof itemId === "string" && itemId.length > 0,
  );
  if (normalizedItemIds.length === 0) return null;
  return {
    id,
    operatorName,
    apiKeyHash: apiKeyHash as Hex,
    itemIds: normalizedItemIds,
    registeredAt,
  };
}

function parseOperatorRegistry(value: unknown): JellyfinOperatorRegistry {
  if (!isRecord(value) || !Array.isArray(value.operators)) {
    return EMPTY_OPERATORS;
  }
  return {
    operators: value.operators
      .map(parseOperator)
      .filter((operator): operator is JellyfinOperator => operator !== null),
  };
}

export async function readJellyfinOperators(
  filePath: string,
): Promise<JellyfinOperatorRegistry> {
  try {
    return parseOperatorRegistry(JSON.parse(await readFile(filePath, "utf8")));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_OPERATORS;
    throw error;
  }
}

export async function writeJellyfinOperators(
  registry: JellyfinOperatorRegistry,
  filePath: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function withOperatorRegistryLock<T>(write: () => Promise<T>): Promise<T> {
  const run = operatorRegistryLock.then(write, write);
  operatorRegistryLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function operatorKeyHash(apiKey: string): Hex {
  return sha256Hex(apiKey.trim());
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

export function authorizeJellyfinRegistration(
  registrationSecret: string | null,
  expectedSecret: string | undefined,
): boolean {
  const supplied = registrationSecret?.trim();
  const expected = expectedSecret?.trim();
  if (!supplied || !expected) return false;
  return timingSafeHashEquals(
    operatorKeyHash(supplied),
    operatorKeyHash(expected),
  );
}

function generateOperatorKey(): string {
  return `tgjf_${randomBytes(32).toString("hex")}`;
}

function generateOperatorId(apiKey: string): string {
  return `jf_${sha256Hex({
    type: "jellyfin-operator",
    apiKey,
  }).slice(2, 14)}`;
}

export function normalizeJellyfinOperatorRegistration(
  input: unknown,
): JellyfinOperatorRegistration {
  if (!isRecord(input)) {
    throw new JellyfinOperatorRegistrationError(
      "Request body must be a JSON object.",
    );
  }
  const wallet = input.wallet;
  if (!isAddressString(wallet)) {
    throw new JellyfinOperatorRegistrationError(
      "wallet must be a valid 0x address.",
    );
  }
  return {
    operatorName: readRequiredText(input, "operatorName"),
    itemId: normalizeItemId(readRequiredText(input, "itemId")),
    title: readOptionalText(input, "title"),
    displayName: readRequiredText(input, "displayName"),
    wallet,
    priceAtomicUsdcPerMinute: readPriceAtomicUsdcPerMinute(
      input.priceAtomicUsdcPerMinute,
    ),
  };
}

function registryEntryForRegistration(
  registration: JellyfinOperatorRegistration,
): CreatorRegistryEntry {
  return {
    itemId: registration.itemId,
    title: registration.title,
    displayName: registration.displayName,
    wallet: registration.wallet,
    priceAtomicUsdcPerMinute: registration.priceAtomicUsdcPerMinute,
    approvalStatus: "operator-approved",
  };
}

export async function registerJellyfinOperator(
  input: unknown,
  options: {
    operatorsPath: string;
    registryPath: string;
    now?: Date;
  },
): Promise<{
  operator: Omit<JellyfinOperator, "apiKeyHash">;
  mapping: CreatorRegistryEntry;
  apiKey: string;
}> {
  const registration = normalizeJellyfinOperatorRegistration(input);
  const apiKey = generateOperatorKey();
  const record: JellyfinOperator = {
    id: generateOperatorId(apiKey),
    operatorName: registration.operatorName,
    apiKeyHash: operatorKeyHash(apiKey),
    itemIds: [registration.itemId],
    registeredAt: (options.now ?? new Date()).toISOString(),
  };
  const mapping = registryEntryForRegistration(registration);

  await withOperatorRegistryLock(async () => {
    const [operators, registry] = await Promise.all([
      readJellyfinOperators(options.operatorsPath),
      readCreatorRegistry(options.registryPath),
    ]);
    if (
      operators.operators.some((operator) =>
        operator.itemIds.includes(mapping.itemId),
      ) ||
      registry.videos.some(
        (entry) =>
          entry.itemId === mapping.itemId ||
          entry.itemIds?.includes(mapping.itemId),
      )
    ) {
      throw new JellyfinOperatorRegistrationError(
        "Jellyfin item is already registered.",
        409,
      );
    }
    await Promise.all([
      writeJellyfinOperators(
        {
          operators: [record, ...operators.operators],
        },
        options.operatorsPath,
      ),
      writeCreatorRegistry(
        {
          videos: [mapping, ...registry.videos],
        },
        options.registryPath,
      ),
    ]);
  });

  return {
    operator: {
      id: record.id,
      operatorName: record.operatorName,
      itemIds: record.itemIds,
      registeredAt: record.registeredAt,
    },
    mapping,
    apiKey,
  };
}

export async function authenticateJellyfinOperator(
  apiKey: string | null,
  operatorsPath: string,
): Promise<JellyfinOperator | null> {
  const trimmed = apiKey?.trim();
  if (!trimmed) return null;
  const suppliedHash = operatorKeyHash(trimmed);
  const registry = await readJellyfinOperators(operatorsPath);
  return (
    registry.operators.find((operator) =>
      timingSafeHashEquals(suppliedHash, operator.apiKeyHash),
    ) ?? null
  );
}
