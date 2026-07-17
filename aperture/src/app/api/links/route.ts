import { NextRequest, NextResponse } from "next/server";
import { LinkRegistryError, listPublicLinks } from "../../../lib/link-registry";
import { handleLinkRegistration } from "../../../lib/link-registration";
import { assertLinkRegistrationRateLimit } from "../../../lib/link-rate-limit";
import { projectPublicData } from "../../../lib/public-data";
import { aperturePublicOrigin } from "../../../lib/public-origin";
import {
  SESSION_COOKIE_NAME,
  getSessionOwner,
  sessionCookieOptions,
  signSession,
} from "../../../lib/account";

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
    assertLinkRegistrationRateLimit(requestIp(request));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  try {
    const sessionOwner = await getSessionOwner();
    const body = (await request.json().catch(() => null)) ?? {};
    const result = await handleLinkRegistration(
      body && typeof body === "object" && !Array.isArray(body)
        ? { ...body, email: undefined }
        : body,
      {
        origin: aperturePublicOrigin(),
        basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
        ...(sessionOwner ? { sessionOwnerId: sessionOwner.ownerId } : {}),
      },
    );
    const response = NextResponse.json(projectPublicData(result), {
      status: 201,
    });
    if (!sessionOwner && result.accountKey) {
      const cookieValue = signSession(result.registered.ownerId);
      if (cookieValue) {
        response.cookies.set(
          SESSION_COOKIE_NAME,
          cookieValue,
          sessionCookieOptions(),
        );
      }
    }
    return response;
  } catch (error) {
    if (error instanceof LinkRegistryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "photo link registration failed" },
      { status: 400 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ links: await listPublicLinks() });
}
