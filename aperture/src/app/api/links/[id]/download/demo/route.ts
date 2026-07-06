import { NextRequest, NextResponse } from "next/server";
import { ARC_USDC } from "../../../../../../lib/chain";
import { APERTURE_LICENSE_FEE_ATOMIC_USDC } from "../../../../../../lib/config";
import {
  createFeeRouterPublicClient,
  usdcRouterAbi,
} from "../../../../../../lib/fee-router";
import { payerAddress, payerWalletId } from "../../../../../../lib/circle-w3s";
import {
  assertDemoUnlockWithinLimits,
  recordDemoUnlock,
} from "../../../../../../lib/link-rate-limit";
import { createW3SPaidFetch } from "../../../../../../lib/x402-custodial";
import { PAYMENT_RESPONSE_HEADER } from "../../../../../../lib/x402-server";

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

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

async function responseError(response: Response): Promise<string> {
  if (response.status === 404) {
    return "This photo link is unavailable.";
  }
  if (response.status === 502) {
    return "The photo source could not be unlocked right now. Use your own wallet or try again shortly.";
  }
  return "The no-wallet unlock could not complete. Use your own wallet or try again shortly.";
}

function streamHeaders(response: Response): Headers {
  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-disposition",
    "cache-control",
    "x-aperture-receipt-hash",
    PAYMENT_RESPONSE_HEADER,
  ]) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  let walletId: string;
  let address: `0x${string}`;
  try {
    walletId = payerWalletId();
    address = payerAddress();
  } catch {
    return jsonError(
      "Custodial unlock isn't configured yet. Use your own wallet to unlock this photo.",
      503,
    );
  }

  const ip = requestIp(request);
  try {
    assertDemoUnlockWithinLimits(ip);
  } catch (error) {
    return jsonError(
      error instanceof Error
        ? error.message
        : "The free-unlock daily budget is used up. Use your own wallet or try again tomorrow.",
      429,
    );
  }

  try {
    const publicClient = createFeeRouterPublicClient();
    const balance = await publicClient.readContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "balanceOf",
      args: [address],
    });
    if (balance < BigInt(APERTURE_LICENSE_FEE_ATOMIC_USDC)) {
      return jsonError(
        "The free-unlock wallet is out of funds. Try unlock with your own wallet.",
        503,
      );
    }
  } catch {
    return jsonError(
      "Could not check the free-unlock wallet balance. Use your own wallet or try again shortly.",
      503,
    );
  }

  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";
  const target = new URL(
    `${basePath}/api/links/${encodeURIComponent(id)}/download`,
    request.nextUrl.origin,
  );
  const paidFetch = createW3SPaidFetch({ walletId, address });
  const response = await paidFetch(target.toString(), { method: "POST" });
  if (!response.ok) {
    const status =
      response.status >= 400 && response.status < 500 && response.status !== 402
        ? response.status
        : 502;
    return jsonError(await responseError(response), status);
  }

  const body = await response.arrayBuffer();
  recordDemoUnlock(ip);
  return new Response(body, {
    status: 200,
    headers: streamHeaders(response),
  });
}
