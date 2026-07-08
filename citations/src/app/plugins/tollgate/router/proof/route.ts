import { NextResponse } from "next/server";
import { buildPeerTubeProof } from "@/lib/peertube-proof";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await buildPeerTubeProof());
}
