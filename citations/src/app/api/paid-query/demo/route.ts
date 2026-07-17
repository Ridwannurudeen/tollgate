import { NextRequest, NextResponse } from "next/server";
import { ARC_USDC } from "@/lib/chain";
import { DEFAULT_CREATOR_SOURCES } from "@/lib/catalog";
import {
  createFeeRouterPublicClient,
  readFeeRouterClaimable,
  usdcRouterAbi,
} from "@/lib/fee-router";
import { payerAddress, payerWalletId } from "@/lib/circle-w3s";
import { JUDGE_DEMO_QUESTION, JUDGE_DEMO_SOURCE_IDS } from "@/lib/judge-demo";
import { PAID_QUERY_PRICE_ATOMIC_USDC } from "@/lib/payments";
import { leptonwebInternalOrigin } from "@/lib/public-origin";
import { reserveDemoPaidQuery } from "@/lib/rate-limit";
import { validateQuestion } from "@/lib/settlement";
import { createW3SPaidFetch } from "@/lib/x402-custodial";

export const runtime = "nodejs";

const JUDGE_DEMO_CREATORS = JUDGE_DEMO_SOURCE_IDS.map((sourceId) => {
  const source = DEFAULT_CREATOR_SOURCES.find(
    (candidate) => candidate.id === sourceId,
  );
  if (!source) {
    throw new Error(`Judge demo source ${sourceId} is not registered.`);
  }
  return {
    sourceId,
    creator: source.creator,
    wallet: source.wallet,
  };
});

type CreatorBalanceSnapshot = (typeof JUDGE_DEMO_CREATORS)[number] & {
  claimableAtomicUsdc: bigint;
};

async function readJudgeCreatorBalances(
  publicClient: ReturnType<typeof createFeeRouterPublicClient>,
): Promise<CreatorBalanceSnapshot[]> {
  return Promise.all(
    JUDGE_DEMO_CREATORS.map(async (creator) => ({
      ...creator,
      claimableAtomicUsdc: await readFeeRouterClaimable(
        creator.wallet,
        publicClient,
      ),
    })),
  );
}

function creatorBalanceChanges(
  before: CreatorBalanceSnapshot[],
  after: CreatorBalanceSnapshot[],
) {
  return before.map((balance, index) => ({
    sourceId: balance.sourceId,
    creator: balance.creator,
    wallet: balance.wallet,
    beforeAtomicUsdc: balance.claimableAtomicUsdc.toString(),
    afterAtomicUsdc: after[index].claimableAtomicUsdc.toString(),
    deltaAtomicUsdc: (
      after[index].claimableAtomicUsdc - balance.claimableAtomicUsdc
    ).toString(),
  }));
}

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

function objectBody(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readQuestion(body: unknown): string {
  if (body && typeof body === "object") {
    const raw = (body as Record<string, unknown>).question;
    if (typeof raw === "string" && raw.trim()) return validateQuestion(raw);
  }
  return JUDGE_DEMO_QUESTION;
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

  // Balance guard: fail cleanly before signing rather than reverting on-chain
  // when the shared wallet is drained.
  const publicClient = createFeeRouterPublicClient();
  try {
    const balance = (await publicClient.readContract({
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

  let creatorBalancesBefore: CreatorBalanceSnapshot[] | undefined;
  if (question === JUDGE_DEMO_QUESTION) {
    try {
      creatorBalancesBefore = await readJudgeCreatorBalances(publicClient);
    } catch (error) {
      return NextResponse.json(
        {
          stage: "creator-balance",
          error:
            error instanceof Error
              ? error.message
              : "Could not read the creators' FeeRouter balances.",
        },
        { status: 503 },
      );
    }
  }

  let reservation: ReturnType<typeof reserveDemoPaidQuery>;
  try {
    reservation = reserveDemoPaidQuery(ip);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rate limited." },
      { status: 429 },
    );
  }

  let sponsorshipStarted = false;
  try {
    const paidFetch = createW3SPaidFetch({ walletId, address });
    const target = new URL("/api/paid-query", leptonwebInternalOrigin());
    sponsorshipStarted = true;
    const response = await paidFetch(target.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const result = objectBody(await response.json().catch(() => null));
    if (!response.ok) {
      if (response.status === 402) reservation.release();
      return NextResponse.json(
        {
          ...result,
          error:
            typeof result.error === "string"
              ? result.error
              : "The custodial demo payment did not settle.",
        },
        { status: 502 },
      );
    }
    let creatorBalances;
    if (creatorBalancesBefore) {
      try {
        const creatorBalancesAfter =
          await readJudgeCreatorBalances(publicClient);
        creatorBalances = creatorBalanceChanges(
          creatorBalancesBefore,
          creatorBalancesAfter,
        );
      } catch (error) {
        return NextResponse.json(
          {
            ...result,
            custodial: true,
            payer: address,
            stage: "creator-balance",
            error:
              error instanceof Error
                ? error.message
                : "Could not read the creators' updated FeeRouter balances.",
            creatorBalancesBefore: creatorBalancesBefore.map((balance) => ({
              sourceId: balance.sourceId,
              creator: balance.creator,
              wallet: balance.wallet,
              beforeAtomicUsdc: balance.claimableAtomicUsdc.toString(),
            })),
          },
          { status: 502 },
        );
      }
    }
    return NextResponse.json(
      { ...result, custodial: true, payer: address, creatorBalances },
      { status: 201 },
    );
  } catch (error) {
    if (!sponsorshipStarted) reservation.release();
    return NextResponse.json(
      {
        stage: "sponsorship",
        error:
          error instanceof Error
            ? error.message
            : "The custodial demo payment failed.",
      },
      { status: 502 },
    );
  }
}
