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
const SESSION_TOKEN_VERSION = "v1";
type SessionTokenPayload = {
  ownerId: string;
  exp: number;
};
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
        redeemed ||
        entry.loginTokenHash !== hash ||
        !entry.loginTokenExpiresAt ||
        Date.parse(entry.loginTokenExpiresAt) <= now
      ) {
        return entry;
      }
      const consumed = { ...entry };
      delete consumed.loginTokenHash;
      delete consumed.loginTokenExpiresAt;
      redeemed = consumed;
      return consumed;
    });
    if (!redeemed) return null;
    await writeWalletRegistry({ photographers }, filePath);
    return redeemed;
  });
}

function sessionSecret(): string | null {
  return process.env.APERTURE_SESSION_SECRET?.trim() || null;
}

function sessionSignature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
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

function isSessionTokenPayload(value: unknown): value is SessionTokenPayload {
  return (
    Boolean(value && typeof value === "object") &&
    typeof (value as SessionTokenPayload).ownerId === "string" &&
    Boolean((value as SessionTokenPayload).ownerId) &&
    typeof (value as SessionTokenPayload).exp === "number" &&
    Number.isSafeInteger((value as SessionTokenPayload).exp)
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

export function signSession(ownerId: string, now = Date.now()): string | null {
  const secret = sessionSecret();
  if (!secret || !ownerId || !Number.isFinite(now)) return null;
  const payload = Buffer.from(
    JSON.stringify({
      ownerId,
      exp: now + SESSION_MAX_AGE_SECONDS * 1_000,
    }),
    "utf8",
  ).toString("base64url");
  const signedPayload = `${SESSION_TOKEN_VERSION}.${payload}`;
  return `${signedPayload}.${sessionSignature(signedPayload, secret)}`;
}

export function verifySession(
  cookieValue: string | undefined,
  now = Date.now(),
): string | null {
  const secret = sessionSecret();
  if (!secret || !cookieValue || !Number.isFinite(now)) return null;
  const [version, payload, suppliedSignature, extra] = cookieValue
    .trim()
    .split(".");
  if (
    version !== SESSION_TOKEN_VERSION ||
    !payload ||
    !suppliedSignature ||
    extra !== undefined
  ) {
    return null;
  }
  const expectedSignature = sessionSignature(`${version}.${payload}`, secret);
  if (!timingSafeHexEquals(suppliedSignature, expectedSignature)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
    if (!isSessionTokenPayload(parsed) || parsed.exp <= now) return null;
    return parsed.ownerId;
  } catch {
    return null;
  }
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
