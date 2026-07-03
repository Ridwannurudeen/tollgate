import { NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";
import { readSources } from "@/lib/catalog";
import { w3sExecuteContract } from "@/lib/circle-w3s";
import {
  FEE_ROUTER_ADDRESS,
  feeRouterV1Abi,
} from "@/lib/fee-router-contract";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ wallet: string }>;
};

export async function POST(_request: Request, context: Context) {
  const { wallet } = await context.params;
  if (!isAddress(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }
  const normalizedWallet = getAddress(wallet);
  const sources = await readSources();
  const source = sources.find(
    (candidate) =>
      candidate.wallet.toLowerCase() === normalizedWallet.toLowerCase() &&
      candidate.custody === "circle-w3s" &&
      candidate.walletId,
  );
  if (!source?.walletId) {
    return NextResponse.json(
      { error: "custodial claim is not configured for this wallet" },
      { status: 501 },
    );
  }
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
    return NextResponse.json(
      { error: "custodial claim needs Circle W3S credentials" },
      { status: 501 },
    );
  }

  const transaction = await w3sExecuteContract({
    walletId: source.walletId,
    walletAddress: source.wallet,
    contractAddress: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "claim",
  });

  return NextResponse.json({ transaction });
}
