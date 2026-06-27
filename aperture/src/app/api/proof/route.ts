import { NextResponse } from "next/server";
import { buildProofPack } from "../../../lib/proof-pack";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await buildProofPack());
}
