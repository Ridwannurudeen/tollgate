import { NextResponse } from "next/server";
import { getSessionOwner } from "../../../../lib/account";
import { readThreadsForOwner } from "../../../../lib/messages";

export const runtime = "nodejs";

export async function GET() {
  const owner = await getSessionOwner();
  if (!owner)
    return NextResponse.json({ error: "not logged in" }, { status: 401 });

  return NextResponse.json({ threads: await readThreadsForOwner(owner.ownerId) });
}
