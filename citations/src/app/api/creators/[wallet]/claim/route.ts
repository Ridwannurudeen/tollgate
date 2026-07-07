import { NextRequest, NextResponse } from "next/server";
import { isAddress, getAddress, type Address } from "viem";
import { readSources } from "@/lib/catalog";
import { w3sExecuteContract } from "@/lib/circle-w3s";
import { readFeeRouterClaimable } from "@/lib/fee-router";
import { FEE_ROUTER_ADDRESS, feeRouterV1Abi } from "@/lib/fee-router-contract";
import { assertClaimRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ wallet: string }>;
};

// Custodial creators have no key to sign with, so this endpoint cannot
// require a wallet signature. The abuse surface is bounded instead:
// claim() always pays the creator's own custodial wallet (never the
// caller), no transaction is submitted when nothing is claimable, the
// source must be verified or explicitly creator-claimed, and calls are rate
// limited.
export async function POST(request: NextRequest, context: Context) {
  const { wallet } = await context.params;
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  const normalizedWallet = getAddress(wallet);
  const rateLimitKey = `${
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local"
  }:${normalizedWallet.toLowerCase()}`;
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
    (candidate) =>
      candidate.verifiedCreator === true ||
      (candidate.creatorClaimed === true && candidate.probation === false),
  );
  if (!source?.walletId) {
    return NextResponse.json(
      { error: "verify or claim source ownership before claiming" },
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
