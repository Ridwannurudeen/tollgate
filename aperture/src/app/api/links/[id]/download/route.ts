import { getAddress, isAddress } from "viem";
import { NextRequest, NextResponse } from "next/server";
import { routeLicensePayment } from "../../../../../lib/fee-router";
import { appendLicenseReceipt } from "../../../../../lib/ledger";
import { handleLinkDownload } from "../../../../../lib/link-download";
import { publicOrigin } from "../../../../../lib/x402-server";

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
  const { id } = await context.params;
  const collector = process.env.APERTURE_LICENSE_COLLECTOR_ADDRESS;
  const result = await handleLinkDownload(id, {
    headers: request.headers,
    origin: publicOrigin(request.headers, "http://127.0.0.1:3092"),
    basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
    remoteAddress: requestIp(request),
    userAgent: request.headers.get("user-agent"),
    referer: request.headers.get("referer"),
    ...(collector && isAddress(collector)
      ? { collectorAddress: getAddress(collector) }
      : {}),
    routeLicensePayment,
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
