import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "./hash";

export const LICENSE_AUTHORIZATION_TTL_MS = 2 * 60 * 1000;

const AUTHORIZATION_DB_PATH = path.join(
  process.cwd(),
  "data",
  "license-authorizations.db",
);
const NONCE_PATTERN = /^[0-9a-f]{32,64}$/i;

export type LicenseAuthorizationScope = {
  sharedLinkKey: string;
  sharedLinkId: string;
  assetIds: readonly string[];
};

export type LicenseAuthorizationReserveScope = LicenseAuthorizationScope & {
  method: string | null | undefined;
};

export type CreateLicenseAuthorizationOptions = {
  now?: number;
  nonce?: string;
  expiresAt?: number;
};

export type ReserveLicenseAuthorizationOptions = {
  now?: number;
  dbPath?: string;
};

export type LicenseAuthorizationClaim = {
  nonce: string;
  expiresAt: number;
};

type LicenseAuthorizationPayload = {
  v: 2;
  keyHash: `0x${string}`;
  sharedLinkId: string;
  assetIdsHash: `0x${string}`;
  method: "POST";
  exp: number;
  nonce: string;
};

type CanonicalScope = {
  keyHash: `0x${string}`;
  sharedLinkId: string;
  assetIdsHash: `0x${string}`;
};

function sessionSecret(): string | null {
  return process.env.APERTURE_SESSION_SECRET?.trim() || null;
}

function canonicalScope(
  scope: LicenseAuthorizationScope,
): CanonicalScope | null {
  if (
    !scope ||
    typeof scope.sharedLinkKey !== "string" ||
    !scope.sharedLinkKey ||
    scope.sharedLinkKey.trim() !== scope.sharedLinkKey ||
    typeof scope.sharedLinkId !== "string" ||
    !scope.sharedLinkId ||
    scope.sharedLinkId.trim() !== scope.sharedLinkId ||
    !Array.isArray(scope.assetIds) ||
    scope.assetIds.length === 0 ||
    scope.assetIds.some(
      (assetId) =>
        typeof assetId !== "string" || !assetId || assetId.trim() !== assetId,
    )
  ) {
    return null;
  }

  const assetIds = [...new Set(scope.assetIds)].sort();
  return {
    keyHash: sha256Hex(scope.sharedLinkKey),
    sharedLinkId: scope.sharedLinkId,
    assetIdsHash: sha256Hex(assetIds),
  };
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`aperture:license-authorization:v2:${payload}`)
    .digest("hex");
}

function timingSafeHexEquals(supplied: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(supplied) || !/^[0-9a-f]{64}$/i.test(expected)) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(supplied, "hex"),
    Buffer.from(expected, "hex"),
  );
}

function isPayload(value: unknown): value is LicenseAuthorizationPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<LicenseAuthorizationPayload>;
  return (
    payload.v === 2 &&
    typeof payload.keyHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(payload.keyHash) &&
    typeof payload.sharedLinkId === "string" &&
    payload.sharedLinkId.length > 0 &&
    typeof payload.assetIdsHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(payload.assetIdsHash) &&
    payload.method === "POST" &&
    typeof payload.exp === "number" &&
    Number.isSafeInteger(payload.exp) &&
    payload.exp > 0 &&
    typeof payload.nonce === "string" &&
    NONCE_PATTERN.test(payload.nonce)
  );
}

function normalizedClaim(
  claim: LicenseAuthorizationClaim | null | undefined,
): LicenseAuthorizationClaim | null {
  if (
    !claim ||
    typeof claim.nonce !== "string" ||
    !NONCE_PATTERN.test(claim.nonce) ||
    !Number.isSafeInteger(claim.expiresAt) ||
    claim.expiresAt <= 0
  ) {
    return null;
  }
  return {
    nonce: claim.nonce.toLowerCase(),
    expiresAt: claim.expiresAt,
  };
}

async function openAuthorizationDatabase(
  dbPath: string,
): Promise<DatabaseSync> {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const sqlite = await import("node:sqlite").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `SQLite license authorization requires Node with node:sqlite support: ${message}`,
    );
  });
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS license_authorizations (
      nonce TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed')),
      reserved_at INTEGER NOT NULL,
      consumed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS license_authorizations_expires_at
      ON license_authorizations (expires_at);
  `);
  return db;
}

function changed(result: { changes: number | bigint }): boolean {
  return result.changes === 1 || result.changes === 1n;
}

export function createLicenseAuthorization(
  scope: LicenseAuthorizationScope,
  options: CreateLicenseAuthorizationOptions = {},
): string | null {
  const secret = sessionSecret();
  const canonical = canonicalScope(scope);
  const now = options.now ?? Date.now();
  const expiresAt = options.expiresAt ?? now + LICENSE_AUTHORIZATION_TTL_MS;
  const nonce = (
    options.nonce ?? randomBytes(16).toString("hex")
  ).toLowerCase();
  if (
    !secret ||
    !canonical ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    !NONCE_PATTERN.test(nonce)
  ) {
    return null;
  }

  const payload = Buffer.from(
    JSON.stringify({
      v: 2,
      keyHash: canonical.keyHash,
      sharedLinkId: canonical.sharedLinkId,
      assetIdsHash: canonical.assetIdsHash,
      method: "POST",
      exp: expiresAt,
      nonce,
    } satisfies LicenseAuthorizationPayload),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export async function reserveLicenseAuthorization(
  token: string,
  scope: LicenseAuthorizationReserveScope,
  options: ReserveLicenseAuthorizationOptions = {},
): Promise<LicenseAuthorizationClaim | null> {
  const secret = sessionSecret();
  const canonical = canonicalScope(scope);
  const now = options.now ?? Date.now();
  if (
    !secret ||
    !canonical ||
    scope.method !== "POST" ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    return null;
  }

  const [payload, suppliedSignature, extra] = token.trim().split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  if (!timingSafeHexEquals(suppliedSignature, signature(payload, secret))) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isPayload(parsed) || parsed.exp <= now) return null;
  if (
    parsed.sharedLinkId !== canonical.sharedLinkId ||
    !timingSafeHexEquals(parsed.keyHash.slice(2), canonical.keyHash.slice(2)) ||
    !timingSafeHexEquals(
      parsed.assetIdsHash.slice(2),
      canonical.assetIdsHash.slice(2),
    )
  ) {
    return null;
  }

  const db = await openAuthorizationDatabase(
    options.dbPath ?? AUTHORIZATION_DB_PATH,
  );
  try {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "DELETE FROM license_authorizations WHERE expires_at <= ?",
      ).run(now);
      const result = db
        .prepare(
          "INSERT OR IGNORE INTO license_authorizations (nonce, expires_at, state, reserved_at) VALUES (?, ?, 'reserved', ?)",
        )
        .run(parsed.nonce, parsed.exp, now);
      db.exec("COMMIT");
      return changed(result)
        ? { nonce: parsed.nonce, expiresAt: parsed.exp }
        : null;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}

export async function completeLicenseAuthorization(
  claim: LicenseAuthorizationClaim,
  dbPath: string = AUTHORIZATION_DB_PATH,
): Promise<boolean> {
  const normalized = normalizedClaim(claim);
  if (!normalized) return false;

  const db = await openAuthorizationDatabase(dbPath);
  try {
    const result = db
      .prepare(
        "UPDATE license_authorizations SET state = 'consumed', consumed_at = ? WHERE nonce = ? AND expires_at = ? AND state = 'reserved'",
      )
      .run(Date.now(), normalized.nonce, normalized.expiresAt);
    return changed(result);
  } finally {
    db.close();
  }
}

export async function releaseLicenseAuthorization(
  claim: LicenseAuthorizationClaim,
  dbPath: string = AUTHORIZATION_DB_PATH,
): Promise<void> {
  const normalized = normalizedClaim(claim);
  if (!normalized) return;

  const db = await openAuthorizationDatabase(dbPath);
  try {
    db.prepare(
      "DELETE FROM license_authorizations WHERE nonce = ? AND expires_at = ? AND state = 'reserved'",
    ).run(normalized.nonce, normalized.expiresAt);
  } finally {
    db.close();
  }
}
