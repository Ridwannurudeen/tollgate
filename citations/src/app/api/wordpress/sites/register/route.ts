import { NextRequest, NextResponse } from "next/server";
import { assertWordPressRegistrationRateLimit } from "@/lib/rate-limit";
import { WordPressRegistryError, registerWordPressSite } from "@/lib/wordpress";

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
    assertWordPressRegistrationRateLimit(requestIp(request));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  try {
    const body = (await request.json()) as unknown;
    const result = await registerWordPressSite(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof WordPressRegistryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "WordPress site registration failed.",
      },
      { status: 400 },
    );
  }
}
