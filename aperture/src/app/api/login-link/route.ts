import { NextRequest, NextResponse } from "next/server";
import {
  findOwnerByEmail,
  generateLoginToken,
  generateSignupToken,
  normalizeAccountEmail,
} from "../../../lib/account";
import { assertLoginLinkRateLimit } from "../../../lib/link-rate-limit";
import { sendLoginLinkEmail, sendSignupLinkEmail } from "../../../lib/mailer";

export const runtime = "nodejs";

const CANONICAL_LOGIN_ORIGIN = "https://tollgate.gudman.xyz";
const LOGIN_HOSTS = new Set([
  "tollgate.gudman.xyz",
  "aperture.gudman.xyz",
  "localhost",
  "127.0.0.1",
  "::1",
]);

function requestIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim());
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "local";
}

function ok() {
  return NextResponse.json({ ok: true });
}

function loginOrigin(request: NextRequest): string {
  const host = request.headers.get("host")?.trim();
  if (!host) return CANONICAL_LOGIN_ORIGIN;
  try {
    const parsed = new URL(`http://${host}`);
    if (!LOGIN_HOSTS.has(parsed.hostname)) return CANONICAL_LOGIN_ORIGIN;
    const local =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    const proto = local
      ? request.headers.get("x-forwarded-proto")?.trim() || "http"
      : "https";
    return `${proto}://${host}`;
  } catch {
    return CANONICAL_LOGIN_ORIGIN;
  }
}

export async function POST(request: NextRequest) {
  try {
    assertLoginLinkRateLimit(requestIp(request));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
  } | null;
  if (!body || typeof body.email !== "string") return ok();
  const email = normalizeAccountEmail(body.email);
  if (!email) return ok();

  const owner = await findOwnerByEmail(email);
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";
  if (owner?.email) {
    const login = await generateLoginToken(owner.ownerId);
    if (login) {
      await sendLoginLinkEmail(
        owner.email,
        `${loginOrigin(request)}${basePath}/login/verify/${login.token}`,
      );
    }
    return ok();
  }

  const signupToken = generateSignupToken(email);
  if (signupToken) {
    await sendSignupLinkEmail(
      email,
      `${loginOrigin(request)}${basePath}/login/verify/${signupToken}`,
    );
  }
  return ok();
}
