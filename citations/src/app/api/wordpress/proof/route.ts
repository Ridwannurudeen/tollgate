import { NextResponse } from "next/server";
import { buildWordPressProof } from "@/lib/wordpress";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await buildWordPressProof());
}
