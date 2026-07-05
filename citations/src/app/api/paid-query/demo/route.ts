import { NextRequest, NextResponse } from "next/server";
import { ARC_USDC } from "@/lib/chain";
import { createFeeRouterPublicClient, usdcRouterAbi } from "@/lib/fee-router";
import { payerAddress, payerWalletId } from "@/lib/circle-w3s";
import { PAID_QUERY_PRICE_ATOMIC_USDC } from "@/lib/payments";
import {
  assertDemoPaidQueryWithinLimits,
  recordDemoPaidQuery,
} from "@/lib/rate-limit";
import { validateQuestion } from "@/lib/settlement";
import { createW3SPaidFetch } from "@/lib/x402-custodial";

export const runtime = "nodejs";

const DEMO_QUESTION =
  "How does Tollgate pay creators when an AI answer cites their work?";

// Prefer proxy-set x-real-ip over the client-controlled left-most XFF so the
// per-IP demo cap can't be spoofed by rotating the header.
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

function readQuestion(body: unknown): string {
  if (body && typeof body === "object") {
    const raw = (body as Record<string, unknown>).question;
    if (typeof raw === "string" && raw.trim()) return validateQuestion(raw);
  }
  return DEMO_QUESTION;
}

export async function POST(request: NextRequest) {
  // The custodial demo settles a real (testnet) x402 payment from a shared
  // wallet, so it is unavailable unless a funded payer wallet is configured.
  let walletId: string;
  let address: `0x${string}`;
  try {
    walletId = payerWalletId();
    address = payerAddress();
  } catch {
    return NextResponse.json(
      { error: "The custodial demo is not configured on this deployment." },
      { status: 503 },
    );
  }

  const ip = requestIp(request);
  try {
    assertDemoPaidQueryWithinLimits(ip);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rate limited." },
      { status: 429 },
    );
  }

  // Balance guard: fail cleanly before signing rather than reverting on-chain
  // when the shared wallet is drained.
  try {
    const balance = (await createFeeRouterPublicClient().readContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
    if (balance < BigInt(PAID_QUERY_PRICE_ATOMIC_USDC)) {
      return NextResponse.json(
        {
          error:
            "The demo wallet is out of testnet USDC. Try the free run, or connect your own wallet.",
        },
        { status: 503 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Could not check the demo wallet balance. Try again shortly." },
      { status: 503 },
    );
  }

  let question: string;
  try {
    question = readQuestion(await request.json().catch(() => ({})));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid question." },
      { status: 400 },
    );
  }

  try {
    const paidFetch = createW3SPaidFetch({ walletId, address });
    const target = new URL("/api/paid-query", request.nextUrl.origin);
    const response = await paidFetch(target.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const result = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            (result as { error?: string })?.error ??
            "The custodial demo payment did not settle.",
        },
        { status: 502 },
      );
    }
    // Only now — after a real settlement — consume the caller's quota.
    recordDemoPaidQuery(ip);
    return NextResponse.json(
      { ...result, custodial: true, payer: address },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The custodial demo payment failed.",
      },
      { status: 502 },
    );
  }
}
