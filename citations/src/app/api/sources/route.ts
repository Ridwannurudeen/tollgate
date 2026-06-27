import { NextRequest, NextResponse } from "next/server";
import { SourceRegistryError, appendSource, readSources } from "@/lib/catalog";

export const runtime = "nodejs";

export async function GET() {
  const sources = await readSources();
  return NextResponse.json({ sources });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as unknown;
    const result = await appendSource(body);
    return NextResponse.json(result, { status: 201 });
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
