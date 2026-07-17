import { NextResponse } from "next/server";
import { getSessionOwner } from "../../../../lib/account";

export const runtime = "nodejs";

export async function POST() {
  const owner = await getSessionOwner();
  if (!owner) {
    return NextResponse.json({ error: "not logged in" }, { status: 401 });
  }
  return NextResponse.json(
    {
      error:
        "Recovery email changes require a verified email link and are disabled.",
    },
    { status: 403 },
  );
}
