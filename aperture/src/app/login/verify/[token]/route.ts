import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  findOwnerByEmail,
  redeemLoginToken,
  sessionCookieOptions,
  signSession,
  verifySignupToken,
} from "../../../../lib/account";
import { registerCreator } from "../../../../lib/onboarding";
import { aperturePublicOrigin } from "../../../../lib/public-origin";

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

function unavailablePage() {
  return loginPage({
    title: "Email login is not configured.",
    status: 503,
    body: '<p style="font-size:16px;line-height:1.65;color:#4f4b3f;">Ask the operator to configure Aperture sessions, then request a new login link.</p>',
  });
}

function signupFailedPage(basePath: string) {
  const loginHref = `${basePath}/login`;
  return loginPage({
    title: "Couldn't create your account.",
    status: 503,
    body: [
      '<p style="font-size:16px;line-height:1.65;color:#4f4b3f;">Aperture could not finish creating your creator account. Request a new link and try again.</p>',
      `<a href="${escapeHtml(loginHref)}" style="display:inline-flex;align-items:center;min-height:42px;padding:0 18px;border:1px solid #0e3d28;border-radius:999px;background:#1e6a47;color:#f6f2e7;font:600 11px IBM Plex Mono,monospace;letter-spacing:.08em;text-decoration:none;text-transform:uppercase;">Request a new link</a>`,
    ].join(""),
  });
}

function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.trim().slice(0, 80);
  return local || "New creator";
}

function redirectWithSession(basePath: string, ownerId: string) {
  const cookieValue = signSession(ownerId);
  if (!cookieValue) return unavailablePage();

  const response = NextResponse.redirect(
    new URL(`${basePath}/dashboard`, aperturePublicOrigin()),
  );
  response.cookies.set(
    SESSION_COOKIE_NAME,
    cookieValue,
    sessionCookieOptions(),
  );
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";
  if (!process.env.APERTURE_SESSION_SECRET?.trim()) {
    return unavailablePage();
  }

  const { token } = await context.params;
  const owner = await redeemLoginToken(token);
  if (owner) return redirectWithSession(basePath, owner.ownerId);

  const signupEmail = verifySignupToken(token);
  if (!signupEmail) return invalidPage(basePath);
  if (await findOwnerByEmail(signupEmail).catch(() => null)) {
    return invalidPage(basePath);
  }
  try {
    const signupOwner = await registerCreator({
      ownerId: `link-${randomUUID()}`,
      displayName: displayNameFromEmail(signupEmail),
      email: signupEmail,
    });
    return redirectWithSession(basePath, signupOwner.ownerId);
  } catch {
    return signupFailedPage(basePath);
  }
}
