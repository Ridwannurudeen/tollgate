import { NextRequest, NextResponse } from "next/server";
import {
  SourceRegistryError,
  appendSource,
  publicSource,
  readSources,
} from "@/lib/catalog";
import {
  assertSourceRegistrationRateLimit,
  requestIp,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET() {
  const sources = await readSources();
  return NextResponse.json({ sources: sources.map(publicSource) });
}

export async function POST(request: NextRequest) {
  try {
    assertSourceRegistrationRateLimit(requestIp(request.headers));
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
      { error: "Source registration failed." },
      { status: 400 },
    );
  }
}
