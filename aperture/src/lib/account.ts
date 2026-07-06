import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sha256Hex } from "./hash";
import {
  readWalletForOwner,
  readWalletRegistry,
  withRegistryWriteLock,
  writeWalletRegistry,
} from "./registry";
import type { WalletRegistryEntry } from "./types";

export const SESSION_COOKIE_NAME = "aperture_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const LOGIN_TOKEN_TTL_MS = 20 * 60 * 1000;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function generateAccountKey(): string {
  return `aptr_${randomBytes(32).toString("hex")}`;
}

export function accountKeyHash(accountKey: string): `0x${string}` {
  return sha256Hex(accountKey.trim());
}

export function normalizeAccountEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

export function maskAccountEmail(email: string): string {
  const normalized = normalizeAccountEmail(email) ?? email.trim();
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "email on file";
  return `${local.slice(0, 1)}***@${domain}`;
}

export async function findOwnerByAccountKey(
  accountKey: string,
  filePath?: string,
): Promise<WalletRegistryEntry | null> {
  if (!accountKey.trim()) return null;
  const hash = accountKeyHash(accountKey);
  const registry = await readWalletRegistry(filePath);
  return (
    registry.photographers.find((entry) => entry.accountKeyHash === hash) ??
    null
  );
}

export async function findOwnerByEmail(
  email: string,
  filePath?: string,
): Promise<WalletRegistryEntry | null> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return null;
  const registry = await readWalletRegistry(filePath);
  return (
    registry.photographers.find((entry) => entry.email === normalized) ?? null
  );
}

export async function generateLoginToken(
  ownerId: string,
  filePath?: string,
): Promise<{ token: string; hash: `0x${string}`; expiresAt: string } | null> {
  const token = randomBytes(32).toString("hex");
  const hash = accountKeyHash(token);
  const expiresAt = new Date(Date.now() + LOGIN_TOKEN_TTL_MS).toISOString();
  return withRegistryWriteLock(async () => {
    const registry = await readWalletRegistry(filePath);
    let found = false;
    const photographers = registry.photographers.map((entry) => {
      if (entry.ownerId !== ownerId) return entry;
      found = true;
      return {
        ...entry,
        loginTokenHash: hash,
        loginTokenExpiresAt: expiresAt,
      };
    });
    if (!found) return null;
    await writeWalletRegistry({ photographers }, filePath);
    return { token, hash, expiresAt };
  });
}

export async function redeemLoginToken(
  token: string,
  filePath?: string,
  now = Date.now(),
): Promise<WalletRegistryEntry | null> {
  const trimmed = token.trim();
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) return null;
  const hash = accountKeyHash(trimmed);
  return withRegistryWriteLock(async () => {
    const registry = await readWalletRegistry(filePath);
    let redeemed: WalletRegistryEntry | null = null;
    const photographers = registry.photographers.map((entry) => {
      if (
        entry.loginTokenHash !== hash ||
        !entry.loginTokenExpiresAt ||
        Date.parse(entry.loginTokenExpiresAt) <= now
      ) {
        return entry;
      }
      const cleared = { ...entry };
      delete cleared.loginTokenHash;
      delete cleared.loginTokenExpiresAt;
      redeemed = cleared;
      return cleared;
    });
    if (!redeemed) return null;
    await writeWalletRegistry({ photographers }, filePath);
    return redeemed;
  });
}

function sessionSecret(): string | null {
  return process.env.APERTURE_SESSION_SECRET?.trim() || null;
}

function sessionSignature(ownerId: string, secret: string): string {
  return createHmac("sha256", secret).update(ownerId).digest("hex");
}

export function signSession(ownerId: string): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  return `${ownerId}.${sessionSignature(ownerId, secret)}`;
}

export function verifySession(cookieValue: string | undefined): string | null {
  const secret = sessionSecret();
  if (!secret || !cookieValue) return null;
  const separator = cookieValue.indexOf(".");
  if (separator <= 0) return null;
  const ownerId = cookieValue.slice(0, separator);
  const supplied = cookieValue.slice(separator + 1);
  if (!ownerId || !/^[0-9a-f]{64}$/i.test(supplied)) return null;
  const expected = sessionSignature(ownerId, secret);
  const suppliedBuffer = Buffer.from(supplied, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (suppliedBuffer.byteLength !== expectedBuffer.byteLength) return null;
  return timingSafeEqual(suppliedBuffer, expectedBuffer) ? ownerId : null;
}

export function sessionCookieOptions(maxAge = SESSION_MAX_AGE_SECONDS) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: process.env.APERTURE_BASE_PATH ?? "/aperture",
    maxAge,
  };
}

export async function getSessionOwner(): Promise<WalletRegistryEntry | null> {
  const cookieStore = await cookies();
  const ownerId = verifySession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!ownerId) return null;
  return readWalletForOwner(ownerId);
}
