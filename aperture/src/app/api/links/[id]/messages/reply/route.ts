import { NextRequest, NextResponse } from "next/server";
import { getSessionOwner } from "../../../../../../lib/account";
import { assertMessageRateLimit } from "../../../../../../lib/link-rate-limit";
import { findLink } from "../../../../../../lib/link-registry";
import { MessageError, sendMessage } from "../../../../../../lib/messages";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
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

export async function POST(request: NextRequest, context: RouteContext) {
  const owner = await getSessionOwner();
  if (!owner)
    return NextResponse.json({ error: "not logged in" }, { status: 401 });

  const { id } = await context.params;
  const link = await findLink(id);
  if (!link) return NextResponse.json({ error: "link not found" }, { status: 404 });
  if (owner.ownerId !== link.ownerId) {
    return NextResponse.json(
      { error: "only the seller can reply on this route" },
      { status: 403 },
    );
  }

  try {
    assertMessageRateLimit(`${requestIp(request)}:${owner.ownerId}`);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    buyerOwnerId?: unknown;
    body?: unknown;
  } | null;
  const buyerOwnerId =
    typeof body?.buyerOwnerId === "string" ? body.buyerOwnerId : "";
  try {
    const message = await sendMessage({
      linkId: id,
      buyerOwnerId,
      senderOwnerId: owner.ownerId,
      body: typeof body?.body === "string" ? body.body : "",
    });
    return NextResponse.json({
      message: {
        id: message.id,
        senderOwnerId: message.senderOwnerId,
        body: message.body,
        createdAt: message.createdAt,
      },
    });
  } catch (error) {
    const status = error instanceof MessageError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "message reply failed" },
      { status },
    );
  }
}
