import { NextRequest, NextResponse } from "next/server";
import {
  SourceRegistryError,
  appendSource,
  publicSource,
  readSources,
} from "@/lib/catalog";
import { assertSourceRegistrationRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  const sources = await readSources();
  return NextResponse.json({ sources: sources.map(publicSource) });
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitKey =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "local";
    assertSourceRegistrationRateLimit(rateLimitKey);
    const body = (await request.json()) as unknown;
    const result = await appendSource(body);
    return NextResponse.json(
      {
        source: publicSource(result.source),
        sources: result.sources.map(publicSource),
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SourceRegistryError) {
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
            : "Source registration failed.",
      },
      { status: 400 },
    );
  }
}
