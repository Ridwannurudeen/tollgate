import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  redeemLoginToken,
  sessionCookieOptions,
  signSession,
} from "../../../../lib/account";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ token: string }>;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function loginPage({
  title,
  body,
  status = 200,
}: {
  title: string;
  body: string;
  status?: number;
}) {
  return new NextResponse(
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      `<title>${escapeHtml(title)} - Aperture</title>`,
      "</head>",
      '<body style="margin:0;background:#f3ede0;color:#171610;font-family:Inter,system-ui,-apple-system,Segoe UI,Arial,sans-serif;">',
      '<main style="width:min(720px,calc(100% - 32px));margin:0 auto;padding:48px 0;">',
      '<p style="margin:0 0 16px;color:#1e6a47;font:600 10px IBM Plex Mono,monospace;letter-spacing:.16em;text-transform:uppercase;">Aperture login</p>',
      `<h1 style="margin:0 0 18px;font:500 clamp(42px,7vw,72px)/.96 Fraunces,Georgia,serif;letter-spacing:-.02em;">${escapeHtml(title)}</h1>`,
      body,
      "</main>",
      "</body>",
      "</html>",
    ].join(""),
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function invalidPage(basePath: string) {
  const loginHref = `${basePath}/login`;
  return loginPage({
    title: "Login link invalid or expired.",
    status: 400,
    body: [
      '<p style="font-size:16px;line-height:1.65;color:#4f4b3f;">Request a new login link and use it within 20 minutes.</p>',
      `<a href="${escapeHtml(loginHref)}" style="display:inline-flex;align-items:center;min-height:42px;padding:0 18px;border:1px solid #0e3d28;border-radius:999px;background:#1e6a47;color:#f6f2e7;font:600 11px IBM Plex Mono,monospace;letter-spacing:.08em;text-decoration:none;text-transform:uppercase;">Request a new link</a>`,
    ].join(""),
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";
  if (!process.env.APERTURE_SESSION_SECRET?.trim()) {
    return loginPage({
      title: "Email login is not configured.",
      status: 503,
      body: '<p style="font-size:16px;line-height:1.65;color:#4f4b3f;">Ask the operator to configure Aperture sessions, then request a new login link.</p>',
    });
  }

  const { token } = await context.params;
  const owner = await redeemLoginToken(token);
  if (!owner) return invalidPage(basePath);

  const cookieValue = signSession(owner.ownerId);
  if (!cookieValue) {
    return loginPage({
      title: "Email login is not configured.",
      status: 503,
      body: '<p style="font-size:16px;line-height:1.65;color:#4f4b3f;">Ask the operator to configure Aperture sessions, then request a new login link.</p>',
    });
  }

  const response = NextResponse.redirect(
    new URL(`${basePath}/dashboard`, request.url),
  );
  response.cookies.set(
    SESSION_COOKIE_NAME,
    cookieValue,
    sessionCookieOptions(),
  );
  return response;
}
