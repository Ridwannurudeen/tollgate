import { NextRequest, NextResponse } from "next/server";
import {
  WordPressRegistryError,
  authenticateWordPressSite,
  wordpressPostStatus,
} from "@/lib/wordpress";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ postId: string }>;
};

async function siteFromRequest(request: NextRequest) {
  return authenticateWordPressSite(request.headers.get("x-tollgate-site-key"));
}

export async function POST(request: NextRequest, context: Context) {
  const site = await siteFromRequest(request);
  if (!site) {
    return NextResponse.json({ error: "invalid site key" }, { status: 401 });
  }

  try {
    const { postId } = await context.params;
    const body = (await request.json()) as unknown;
    const status = await wordpressPostStatus(site, postId, body);
    return NextResponse.json({
      paid: status.paid,
      eventId: status.eventId,
      receiptHash: status.receipt?.receiptHash ?? null,
      settlementMode: status.receipt?.settlementMode ?? null,
    });
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
            : "WordPress post status failed.",
      },
      { status: 400 },
    );
  }
}
