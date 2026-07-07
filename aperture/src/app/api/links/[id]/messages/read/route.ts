import { NextRequest, NextResponse } from "next/server";
import { getSessionOwner } from "../../../../../../lib/account";
import { findLink } from "../../../../../../lib/link-registry";
import { markThreadRead, MessageError } from "../../../../../../lib/messages";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const owner = await getSessionOwner();
  if (!owner)
    return NextResponse.json({ error: "not logged in" }, { status: 401 });

  const { id } = await context.params;
  const link = await findLink(id);
  if (!link) return NextResponse.json({ error: "link not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    buyerOwnerId?: unknown;
  } | null;
  const buyerOwnerId =
    owner.ownerId === link.ownerId
      ? typeof body?.buyerOwnerId === "string"
        ? body.buyerOwnerId
        : ""
      : owner.ownerId;

  try {
    const messages = await markThreadRead(id, buyerOwnerId, owner.ownerId);
    return NextResponse.json({
      ok: true,
      unreadCount: messages.filter(
        (message) =>
          message.senderOwnerId !== owner.ownerId &&
          !(message.readBy ?? []).includes(owner.ownerId),
      ).length,
    });
  } catch (error) {
    const status = error instanceof MessageError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "message read failed" },
      { status },
    );
  }
}
