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
type SignupTokenPayload = {
  email: string;
  exp: number;
};

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

// Non-consuming lookup: the token stays valid until it expires (its 20-min TTL)
// rather than being cleared on first use. Email providers (Gmail, security
// scanners) pre-fetch links to check them, which would otherwise burn a
// single-use token before the human clicks. A fresh login-link request
// overwrites loginTokenHash, invalidating any prior token.
export async function redeemLoginToken(
  token: string,
  filePath?: string,
  now = Date.now(),
): Promise<WalletRegistryEntry | null> {
  const trimmed = token.trim();
  if (!/^[0-9a-f]{64}$/i.test(trimmed)) return null;
  const hash = accountKeyHash(trimmed);
  const registry = await readWalletRegistry(filePath);
  return (
    registry.photographers.find(
      (entry) =>
        entry.loginTokenHash === hash &&
        !!entry.loginTokenExpiresAt &&
        Date.parse(entry.loginTokenExpiresAt) > now,
    ) ?? null
  );
}

function sessionSecret(): string | null {
  return process.env.APERTURE_SESSION_SECRET?.trim() || null;
}

function sessionSignature(ownerId: string, secret: string): string {
  return createHmac("sha256", secret).update(ownerId).digest("hex");
}

function signupTokenSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function timingSafeHexEquals(supplied: string, expected: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
  const suppliedBuffer = Buffer.from(supplied, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    suppliedBuffer.byteLength === expectedBuffer.byteLength &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

function isSignupTokenPayload(value: unknown): value is SignupTokenPayload {
  return (
    Boolean(value && typeof value === "object") &&
    typeof (value as SignupTokenPayload).email === "string" &&
    typeof (value as SignupTokenPayload).exp === "number" &&
    Number.isFinite((value as SignupTokenPayload).exp)
  );
}

export function generateSignupToken(
  email: string,
  now = Date.now(),
): string | null {
  const secret = sessionSecret();
  const normalizedEmail = normalizeAccountEmail(email);
  if (!secret || !normalizedEmail) return null;
  const payload = Buffer.from(
    JSON.stringify({
      email: normalizedEmail,
      exp: now + LOGIN_TOKEN_TTL_MS,
    }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${signupTokenSignature(payload, secret)}`;
}

export function verifySignupToken(
  token: string,
  now = Date.now(),
): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const [payload, suppliedSignature, extra] = token.trim().split(".");
  if (!payload || !suppliedSignature || extra !== undefined) return null;
  const expectedSignature = signupTokenSignature(payload, secret);
  if (!timingSafeHexEquals(suppliedSignature, expectedSignature)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
    if (!isSignupTokenPayload(parsed) || parsed.exp <= now) return null;
    const normalizedEmail = normalizeAccountEmail(parsed.email);
    return normalizedEmail && normalizedEmail === parsed.email
      ? normalizedEmail
      : null;
  } catch {
    return null;
  }
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
  return timingSafeHexEquals(supplied, expected) ? ownerId : null;
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
