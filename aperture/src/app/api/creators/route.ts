import { NextResponse } from "next/server";
import { registerCreator } from "../../../lib/onboarding";
import type { WalletRegistryEntry } from "../../../lib/types";

export const runtime = "nodejs";

function publicRegistered(entry: WalletRegistryEntry) {
  return {
    ownerId: entry.ownerId,
    displayName: entry.displayName,
    wallet: entry.wallet,
    approvalStatus: entry.approvalStatus,
    custody: entry.custody,
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const {
    ownerId,
    displayName,
    wallet,
    ownershipSignature,
    ownershipTimestamp,
  } = body as {
    ownerId?: string;
    displayName?: string;
    wallet?: string;
    ownershipSignature?: string;
    ownershipTimestamp?: string;
  };

  try {
    const entry = await registerCreator({
      ownerId: ownerId ?? "",
      displayName: displayName ?? "",
      wallet,
      ownershipSignature,
      ownershipTimestamp,
    });
    return NextResponse.json({ registered: publicRegistered(entry) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "registration failed" },
      { status: 400 },
    );
  }
}
