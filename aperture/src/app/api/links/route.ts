import { NextRequest, NextResponse } from "next/server";
import { LinkRegistryError } from "../../../lib/link-registry";
import { handleLinkRegistration } from "../../../lib/link-registration";
import { assertLinkRegistrationRateLimit } from "../../../lib/link-rate-limit";
import { publicOrigin } from "../../../lib/x402-server";

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
    const result = await handleLinkRegistration(
      (await request.json().catch(() => null)) ?? {},
      {
        origin: publicOrigin(request.headers, "http://127.0.0.1:3092"),
        basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
      },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const status = error instanceof LinkRegistryError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "photo link registration failed",
      },
      { status },
    );
  }
}
