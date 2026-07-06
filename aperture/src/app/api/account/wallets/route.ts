import { NextRequest, NextResponse } from "next/server";
import { getSessionOwner } from "../../../../lib/account";
import {
  readWalletRegistry,
  withRegistryWriteLock,
  writeWalletRegistry,
} from "../../../../lib/registry";

export const runtime = "nodejs";

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const LINKED_WALLET_LIMIT = 10;

function normalizeWallet(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!WALLET_PATTERN.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

async function readWallet(request: NextRequest): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as {
    wallet?: unknown;
  } | null;
  return body ? normalizeWallet(body.wallet) : null;
}

async function updateLinkedWallets({
  ownerId,
  wallet,
  action,
}: {
  ownerId: string;
  wallet: string;
  action: "add" | "remove";
}): Promise<string[] | null> {
  return withRegistryWriteLock(async () => {
    const registry = await readWalletRegistry();
    let nextLinkedWallets: string[] | null = null;
    const photographers = registry.photographers.map((entry) => {
      if (entry.ownerId !== ownerId) return entry;
      const nativeWallet = entry.wallet.toLowerCase();
      const linkedWallets = Array.from(
        new Set(
          (entry.linkedWallets ?? [])
            .map((candidate) => candidate.toLowerCase())
            .filter((candidate) => WALLET_PATTERN.test(candidate)),
        ),
      ).filter((candidate) => candidate !== nativeWallet);
      if (action === "add" && wallet !== nativeWallet) {
        if (!linkedWallets.includes(wallet)) {
          if (linkedWallets.length >= LINKED_WALLET_LIMIT) {
            throw new Error("linked wallet limit reached.");
          }
          linkedWallets.push(wallet);
        }
      }
      if (action === "remove") {
        nextLinkedWallets = linkedWallets.filter(
          (candidate) => candidate !== wallet,
        );
      } else {
        nextLinkedWallets = linkedWallets;
      }
      return {
        ...entry,
        ...(nextLinkedWallets.length > 0
          ? { linkedWallets: nextLinkedWallets }
          : { linkedWallets: undefined }),
      };
    });
    if (!nextLinkedWallets) return null;
    await writeWalletRegistry({ photographers });
    return nextLinkedWallets;
  });
}

async function mutate(request: NextRequest, action: "add" | "remove") {
  const owner = await getSessionOwner();
  if (!owner)
    return NextResponse.json({ error: "not logged in" }, { status: 401 });

  const wallet = await readWallet(request);
  if (!wallet) {
    return NextResponse.json(
      { error: "wallet must be a 20-byte EVM address" },
      { status: 400 },
    );
  }

  try {
    const linkedWallets = await updateLinkedWallets({
      ownerId: owner.ownerId,
      wallet,
      action,
    });
    if (!linkedWallets) {
      return NextResponse.json({ error: "account not found" }, { status: 404 });
    }
    return NextResponse.json({ linkedWallets });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "wallet update failed",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  return mutate(request, "add");
}

export async function DELETE(request: NextRequest) {
  return mutate(request, "remove");
}
