import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { registerCreator } from "../../../lib/onboarding";
import { publicWalletRegistryEntry } from "../../../lib/registry";
import type { WalletRegistryEntry } from "../../../lib/types";

export const runtime = "nodejs";

function publicRegistered(entry: WalletRegistryEntry) {
  const projected = publicWalletRegistryEntry(entry);
  return {
    ownerId: projected.ownerId,
    displayName: projected.displayName,
    wallet: projected.wallet,
    approvalStatus: projected.approvalStatus,
    custody: projected.custody,
  };
}

function registrationAuthorized(request: Request, expected: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedHash = createHash("sha256")
    .update(authorization.slice("Bearer ".length))
    .digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

export async function POST(request: Request) {
  const registrationSecret =
    process.env.APERTURE_CREATOR_REGISTRATION_SECRET?.trim();
  if (!registrationSecret) {
    return NextResponse.json(
      { error: "creator registration is not configured" },
      { status: 503 },
    );
  }
  if (!registrationAuthorized(request, registrationSecret)) {
    return NextResponse.json(
      { error: "invalid registration capability" },
      { status: 401 },
    );
  }
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
    return NextResponse.json({ error: "registration failed" }, { status: 400 });
  }
}
