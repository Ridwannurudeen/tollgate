import { NextResponse } from "next/server";
import { evaluateLicenseCheck } from "../../../lib/license-check";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const result = await evaluateLicenseCheck({
    originalUri: request.headers.get("x-original-uri"),
    originalMethod: request.headers.get("x-original-method"),
    originalImmichShareKey: request.headers.get("x-original-immich-share-key"),
    originalImmichShareSlug: request.headers.get(
      "x-original-immich-share-slug",
    ),
  });

  if (result.allowed) return new Response(null, { status: result.status });
  return NextResponse.json(result.body, { status: result.status });
}
