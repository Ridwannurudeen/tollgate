import { NextResponse } from "next/server";
import { publicSource, readSources } from "@/lib/catalog";
import { getCreatorEvidence, readLedger } from "@/lib/ledger";
import type { CreatorSource } from "@/lib/types";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ wallet: string }>;
};

const WALLET_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function summarySource(
  source: CreatorSource,
  evidence: ReturnType<typeof getCreatorEvidence>,
): CreatorSource & { citationCount: number; earnedAtomicUsdc: number } {
  const rest = { ...publicSource(source) };
  const earnings = evidence?.sources.find(
    (candidate) => candidate.sourceId === source.id,
  );
  delete rest.ownershipProof;
  return {
    ...rest,
    citationCount: earnings?.citationCount ?? 0,
    earnedAtomicUsdc: earnings?.earnedAtomicUsdc ?? 0,
  };
}

export async function GET(_request: Request, context: Context) {
  const { wallet } = await context.params;
  if (!WALLET_PATTERN.test(wallet)) {
    return NextResponse.json({ error: "invalid wallet" }, { status: 400 });
  }

  const normalizedWallet = wallet.toLowerCase();
  const [ledger, sources] = await Promise.all([readLedger(), readSources()]);
  const evidence = getCreatorEvidence(ledger, wallet);
  const walletSources = sources.filter(
    (source) => source.wallet.toLowerCase() === normalizedWallet,
  );

  return NextResponse.json(
    {
      wallet,
      earnings: {
        sourceCount: evidence?.sourceCount ?? 0,
        citationCount: evidence?.citationCount ?? 0,
        earnedAtomicUsdc: evidence?.earnedAtomicUsdc ?? 0,
      },
      sources: walletSources.map((source) => summarySource(source, evidence)),
    },
    {
      headers: {
        "cache-control": "public, max-age=30",
      },
    },
  );
}
