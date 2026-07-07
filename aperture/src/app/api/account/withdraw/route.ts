import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { getSessionOwner } from "../../../../lib/account";
import { assertWithdrawRateLimit } from "../../../../lib/link-rate-limit";
import {
  readCustodialUsdcBalance,
  withdrawCustodialUsdc,
} from "../../../../lib/withdraw";

export const runtime = "nodejs";

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

function parseAmount(value: unknown): bigint | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    return BigInt(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

async function readBody(request: NextRequest): Promise<{
  toAddress: Address | null;
  amountAtomicUsdc: bigint | null;
}> {
  const body = (await request.json().catch(() => null)) as {
    toAddress?: unknown;
    amountAtomicUsdc?: unknown;
  } | null;
  const rawToAddress = body?.toAddress;
  return {
    toAddress:
      typeof rawToAddress === "string" && isAddress(rawToAddress)
        ? getAddress(rawToAddress)
        : null,
    amountAtomicUsdc: parseAmount(body?.amountAtomicUsdc),
  };
}

export async function GET() {
  const owner = await getSessionOwner();
  if (!owner)
    return NextResponse.json({ error: "not logged in" }, { status: 401 });
  if (owner.custody !== "circle-w3s" || !owner.walletId) {
    return NextResponse.json(
      {
        error:
          "only custodial wallets can withdraw this way - self-custody wallets already hold your funds",
      },
      { status: 400 },
    );
  }

  const balance = await readCustodialUsdcBalance(owner.wallet);
  return NextResponse.json({
    wallet: owner.wallet,
    balanceAtomicUsdc: balance.toString(),
  });
}

export async function POST(request: NextRequest) {
  const owner = await getSessionOwner();
  if (!owner)
    return NextResponse.json({ error: "not logged in" }, { status: 401 });
  if (owner.custody !== "circle-w3s" || !owner.walletId) {
    return NextResponse.json(
      {
        error:
          "only custodial wallets can withdraw this way - self-custody wallets already hold your funds",
      },
      { status: 400 },
    );
  }

  const { toAddress, amountAtomicUsdc } = await readBody(request);
  if (!toAddress) {
    return NextResponse.json(
      { error: "destination must be a 20-byte EVM address" },
      { status: 400 },
    );
  }
  if (getAddress(toAddress) === getAddress(owner.wallet)) {
    return NextResponse.json(
      { error: "destination cannot be the custodial wallet itself" },
      { status: 400 },
    );
  }
  if (getAddress(toAddress) === zeroAddress) {
    return NextResponse.json(
      { error: "destination cannot be the zero address" },
      { status: 400 },
    );
  }
  if (!amountAtomicUsdc) {
    return NextResponse.json(
      { error: "amountAtomicUsdc must be a positive integer" },
      { status: 400 },
    );
  }

  try {
    assertWithdrawRateLimit(
      `${requestIp(request)}:${owner.ownerId}:${owner.wallet.toLowerCase()}`,
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
    return NextResponse.json(
      { error: "custodial withdraw needs Circle W3S credentials" },
      { status: 501 },
    );
  }

  try {
    const transaction = await withdrawCustodialUsdc({
      walletId: owner.walletId,
      walletAddress: owner.wallet,
      toAddress,
      amountAtomicUsdc,
    });
    return NextResponse.json({
      withdrawn: true,
      amountAtomicUsdc: amountAtomicUsdc.toString(),
      transaction,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "custodial withdraw failed",
      },
      { status: 400 },
    );
  }
}
