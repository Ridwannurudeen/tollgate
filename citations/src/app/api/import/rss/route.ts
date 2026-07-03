import { NextRequest, NextResponse } from "next/server";
import { discoverRssPosts } from "@/lib/rss-import";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }
    return NextResponse.json(await discoverRssPosts(body.url));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "RSS discovery failed.",
      },
      { status: 400 },
    );
  }
}
