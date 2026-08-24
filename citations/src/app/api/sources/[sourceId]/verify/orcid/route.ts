import { NextRequest, NextResponse } from "next/server";
import { findSource } from "@/lib/catalog";
import {
  ORCID_STATE_COOKIE_NAME,
  ORCID_STATE_MAX_AGE_SECONDS,
  createOrcidOAuthState,
  orcidAuthorizationUrl,
  orcidCookieOptions,
  orcidOAuthEnabled,
} from "@/lib/orcid-oauth";
import { leptonwebPublicOrigin } from "@/lib/public-origin";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ sourceId: string }>;
};

export async function GET(_request: NextRequest, context: Context) {
  if (!orcidOAuthEnabled()) {
    return NextResponse.json(
      { error: "ORCID verification is not configured." },
      { status: 503 },
    );
  }

  const { sourceId } = await context.params;
  const source = await findSource(sourceId);
  if (!source) {
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }
  if (!source.doi) {
    return NextResponse.json(
      { error: "This source does not have a DOI to verify." },
      { status: 400 },
    );
  }

  const callbackUrl = `${leptonwebPublicOrigin()}/api/sources/${encodeURIComponent(sourceId)}/verify/orcid/callback`;
  const issued = createOrcidOAuthState(sourceId);
  const response = NextResponse.redirect(
    orcidAuthorizationUrl(callbackUrl, issued.state),
  );
  response.cookies.set(
    ORCID_STATE_COOKIE_NAME,
    issued.cookie,
    orcidCookieOptions(sourceId, ORCID_STATE_MAX_AGE_SECONDS),
  );
  return response;
}
