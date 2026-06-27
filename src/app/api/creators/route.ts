import { NextResponse } from "next/server";
import { registerCreator } from "../../../lib/onboarding";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { ownerId, displayName, wallet } = body as {
    ownerId?: string;
    displayName?: string;
    wallet?: string;
  };

  try {
    const entry = await registerCreator({
      ownerId: ownerId ?? "",
      displayName: displayName ?? "",
      wallet,
    });
    return NextResponse.json({ registered: entry });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "registration failed" },
      { status: 400 },
    );
  }
}
