import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  findOwnerByAccountKey,
  sessionCookieOptions,
  signSession,
} from "../../../lib/account";
import { assertSessionLoginRateLimit } from "../../../lib/link-rate-limit";

export const runtime = "nodejs";

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

export async function POST(request: NextRequest) {
  try {
    assertSessionLoginRateLimit(requestIp(request));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    accountKey?: unknown;
  } | null;
  if (!body || typeof body.accountKey !== "string" || !body.accountKey.trim()) {
    return NextResponse.json(
      { error: "accountKey is required" },
      { status: 400 },
    );
  }
  const owner = await findOwnerByAccountKey(body.accountKey);
  if (!owner) {
    return NextResponse.json(
      { error: "account key not found" },
      { status: 401 },
    );
  }
  const cookieValue = signSession(owner.ownerId);
  if (!cookieValue) {
    return NextResponse.json(
      { error: "Aperture login is not configured." },
      { status: 503 },
    );
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    cookieValue,
    sessionCookieOptions(),
  );
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", sessionCookieOptions(0));
  return response;
}
