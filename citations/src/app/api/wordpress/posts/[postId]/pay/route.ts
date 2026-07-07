import { NextRequest, NextResponse } from "next/server";
import { assertWordPressPayRateLimit } from "@/lib/rate-limit";
import {
  WordPressRegistryError,
  authenticateWordPressSite,
  settleWordPressPost,
} from "@/lib/wordpress";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ postId: string }>;
};

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

export async function POST(request: NextRequest, context: Context) {
  const site = await authenticateWordPressSite(
    request.headers.get("x-tollgate-site-key"),
  );
  if (!site) {
    return NextResponse.json({ error: "invalid site key" }, { status: 401 });
  }

  try {
    assertWordPressPayRateLimit(`${site.id}:${requestIp(request)}`);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  try {
    const { postId } = await context.params;
    const body = (await request.json()) as unknown;
    const result = await settleWordPressPost(site, postId, body);
    return NextResponse.json(
      {
        paid: result.paid,
        created: result.created,
        eventId: result.eventId,
        queryId: result.query.id,
        receiptHash: result.receipt.receiptHash,
        settlementMode: result.receipt.settlementMode,
        amountAtomicUsdc: result.receipt.amountAtomicUsdc,
      },
      { status: result.created ? 201 : 200 },
    );
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
            : "WordPress payment failed.",
      },
      { status: 400 },
    );
  }
}
