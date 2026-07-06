import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { sha256Hex } from "./hash";
import { readWalletForOwner, readWalletRegistry } from "./registry";
import type { WalletRegistryEntry } from "./types";

export const SESSION_COOKIE_NAME = "aperture_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function generateAccountKey(): string {
  return `aptr_${randomBytes(32).toString("hex")}`;
}

export function accountKeyHash(accountKey: string): `0x${string}` {
  return sha256Hex(accountKey.trim());
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
