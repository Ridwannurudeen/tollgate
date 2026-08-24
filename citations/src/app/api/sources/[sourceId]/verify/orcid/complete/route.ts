import { NextRequest, NextResponse } from "next/server";
import { findSource } from "@/lib/catalog";
import { releaseEscrowForSource } from "@/lib/escrow";
import {
  ORCID_SESSION_COOKIE_NAME,
  orcidCookieOptions,
  orcidOAuthEnabled,
} from "@/lib/orcid-oauth";
import { leptonwebPublicOrigin } from "@/lib/public-origin";
import {
  OrcidVerificationError,
  verifySourceByOrcidSession,
} from "@/lib/source-verification";

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
  const source = await findSource(sourceId);
  if (!source) {
    return NextResponse.json({ error: "source not found" }, { status: 404 });
  }
  const session = request.cookies.get(ORCID_SESSION_COOKIE_NAME)?.value;
  try {
    const result = await verifySourceByOrcidSession(source, session);
    await releaseEscrowForSource(result.source);
    const response = NextResponse.redirect(
      `${leptonwebPublicOrigin()}/sources/${encodeURIComponent(sourceId)}?orcid=verified#verify`,
    );
    response.cookies.set(
      ORCID_SESSION_COOKIE_NAME,
      "",
      orcidCookieOptions(sourceId, 0),
    );
    return response;
  } catch (error) {
    if (error instanceof OrcidVerificationError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "ORCID verification failed." },
      { status: 500 },
    );
  }
}
