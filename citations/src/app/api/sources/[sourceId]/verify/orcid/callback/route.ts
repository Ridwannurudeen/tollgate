import { NextRequest, NextResponse } from "next/server";
import {
  ORCID_SESSION_COOKIE_NAME,
  ORCID_SESSION_MAX_AGE_SECONDS,
  ORCID_STATE_COOKIE_NAME,
  createOrcidSession,
  exchangeOrcidCode,
  orcidCookieOptions,
  orcidOAuthEnabled,
  verifyOrcidOAuthState,
} from "@/lib/orcid-oauth";
import { leptonwebPublicOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ sourceId: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  if (!orcidOAuthEnabled()) {
    return NextResponse.json(
      { error: "ORCID verification is not configured." },
      { status: 503 },
    );
  }

  const { sourceId } = await context.params;
  const code = request.nextUrl.searchParams.get("code") ?? "";
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const stateCookie = request.cookies.get(ORCID_STATE_COOKIE_NAME)?.value;
  if (!code || !verifyOrcidOAuthState(stateCookie, state, sourceId)) {
    return NextResponse.json(
      { error: "ORCID OAuth state did not match this session." },
      { status: 400 },
    );
  }

  const callbackUrl = `${leptonwebPublicOrigin()}/api/sources/${encodeURIComponent(sourceId)}/verify/orcid/callback`;
  try {
    const orcidId = await exchangeOrcidCode(code, callbackUrl);
    const session = createOrcidSession(sourceId, orcidId);
    const response = NextResponse.redirect(
      `${leptonwebPublicOrigin()}/api/sources/${encodeURIComponent(sourceId)}/verify/orcid/complete`,
    );
    response.cookies.set(
      ORCID_STATE_COOKIE_NAME,
      "",
      orcidCookieOptions(sourceId, 0),
    );
    response.cookies.set(
      ORCID_SESSION_COOKIE_NAME,
      session,
      orcidCookieOptions(sourceId, ORCID_SESSION_MAX_AGE_SECONDS),
    );
    return response;
  } catch {
    return NextResponse.json(
      { error: "ORCID sign-in could not be completed." },
      { status: 502 },
    );
  }
}
