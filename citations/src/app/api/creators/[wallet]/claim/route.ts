import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isAddress, getAddress, type Address } from "viem";
import { readSources } from "@/lib/catalog";
import { w3sExecuteContract } from "@/lib/circle-w3s";
import { readFeeRouterClaimable } from "@/lib/fee-router";
import { FEE_ROUTER_ADDRESS, feeRouterV1Abi } from "@/lib/fee-router-contract";
import { assertClaimRateLimit, requestIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ wallet: string }>;
};

function claimAuthorized(request: NextRequest, expected: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const suppliedHash = createHash("sha256").update(supplied).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

export async function POST(request: NextRequest, context: Context) {
  const { wallet } = await context.params;
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  const claimToken = process.env.TOLLGATE_CUSTODIAL_CLAIM_TOKEN;
  if (!claimToken) {
    return NextResponse.json(
      { error: "custodial claims are not configured" },
      { status: 503 },
    );
  }
  if (!claimAuthorized(request, claimToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const normalizedWallet = getAddress(wallet);
  const rateLimitKey = `${requestIp(request.headers)}:${normalizedWallet.toLowerCase()}`;
  try {
    assertClaimRateLimit(rateLimitKey);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }
  const sources = await readSources();
  const custodialSources = sources.filter(
    (candidate) =>
      candidate.wallet.toLowerCase() === normalizedWallet.toLowerCase() &&
      candidate.custody === "circle-w3s" &&
      candidate.walletId,
  );
  if (custodialSources.length === 0) {
    return NextResponse.json(
      { error: "custodial claim is not configured for this wallet" },
      { status: 501 },
    );
  }
  const source = custodialSources.find(
    (candidate) => candidate.verifiedCreator === true,
  );
  if (!source?.walletId) {
    return NextResponse.json(
      { error: "verify source ownership before claiming" },
      { status: 403 },
    );
  }
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
    return NextResponse.json(
      { error: "custodial claim needs Circle W3S credentials" },
      { status: 501 },
    );
  }

  const claimable = await readFeeRouterClaimable(normalizedWallet as Address);
  if (claimable === 0n) {
    return NextResponse.json({
      claimed: false,
      claimableAtomicUsdc: "0",
      message: "nothing to claim",
    });
  }

  const transaction = await w3sExecuteContract({
    walletId: source.walletId,
    walletAddress: source.wallet,
    contractAddress: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "claim",
  });

  return NextResponse.json({
    claimed: true,
    claimableAtomicUsdc: claimable.toString(),
    transaction,
  });
}
