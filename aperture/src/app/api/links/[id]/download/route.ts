import { NextRequest, NextResponse } from "next/server";
import { appendLicenseReceipt } from "../../../../../lib/ledger";
import { handleLinkDownload } from "../../../../../lib/link-download";
import { assertLicenseDownloadRateLimit } from "../../../../../lib/link-rate-limit";
import { aperturePublicOrigin } from "../../../../../lib/public-origin";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function requestIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim());
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "local";
}

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    assertLicenseDownloadRateLimit(requestIp(request));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "license download limited",
      },
      { status: 429 },
    );
  }

  const { id } = await context.params;
  const result = await handleLinkDownload(id, {
    headers: request.headers,
    origin: aperturePublicOrigin(),
    basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
    remoteAddress: requestIp(request),
    userAgent: request.headers.get("user-agent"),
    referer: request.headers.get("referer"),
    appendReceipt: async (input) => {
      const result = await appendLicenseReceipt(input);
      return { receipt: result.receipt, created: result.created };
    },
  });

  if ("bytes" in result) {
    const body = new ArrayBuffer(result.bytes.byteLength);
    new Uint8Array(body).set(result.bytes);
    return new Response(body, {
      status: result.status,
      headers: result.headers,
    });
  }

  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
