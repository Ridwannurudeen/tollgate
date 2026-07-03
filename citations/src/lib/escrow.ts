import {
  routeEscrowReleasePayment,
  type FeeRouterRouteOptions,
} from "./fee-router";
import { sha256Hex } from "./hash";
import { appendSettlement, readLedger } from "./ledger";
import { buildSourceContent } from "./source-content";
import type {
  Citation,
  CreatorSource,
  PaymentReceipt,
  QueryRecord,
  SettlementResult,
} from "./types";

export type EscrowReleaseResult = {
  released: boolean;
  amountAtomicUsdc: number;
  releasedReceiptHashes: string[];
  settlement?: SettlementResult;
};

export type EscrowReleaseOptions = FeeRouterRouteOptions & {
  ledgerPath?: string;
};

export function shouldEscrowSource(source: CreatorSource): boolean {
  return (
    process.env.TOLLGATE_ESCROW_UNVERIFIED === "1" &&
    source.sourceKind === "external" &&
    source.verifiedCreator !== true
  );
}

function releasedEscrowHashes(receipts: PaymentReceipt[]): Set<string> {
  const hashes = new Set<string>();
  for (const receipt of receipts) {
    if (receipt.payoutPolicy !== "escrow-release") continue;
    for (const released of receipt.releasedReceiptHashes ?? []) {
      hashes.add(released);
    }
  }
  return hashes;
}

export function pendingEscrowReceipts(
  receipts: PaymentReceipt[],
  sourceId: string,
): PaymentReceipt[] {
  const released = releasedEscrowHashes(receipts);
  return receipts.filter(
    (receipt) =>
      receipt.sourceId === sourceId &&
      receipt.settlementMode === "escrowed" &&
      receipt.payoutPolicy === "escrow-unverified" &&
      !released.has(receipt.receiptHash),
  );
}

function releaseQueryRecord(
  source: CreatorSource,
  amountAtomicUsdc: number,
  releasedReceiptHashes: string[],
  createdAt: string,
): QueryRecord {
  const content = buildSourceContent(source, createdAt);
  const citation: Citation = {
    sourceId: source.id,
    title: source.title,
    creator: source.creator,
    handle: source.handle,
    wallet: source.wallet,
    url: source.url,
    amountAtomicUsdc,
    reason: "Escrow release after source ownership verification.",
    canonicalUrl: content.canonicalUrl,
    previewExcerpt: content.previewExcerpt,
    paidExcerpt: content.paidExcerpt,
    sourceContentHash: content.contentHash,
    sourceExcerptHash: content.excerptHash,
    contentFetchedAt: content.fetchedAt,
    sourceKind: source.sourceKind,
    creatorKind: source.creatorKind,
    verifiedCreator: source.verifiedCreator,
    ownershipProof: source.ownershipProof,
    payoutPolicy: "escrow-release",
    contributors: source.contributors,
  };
  const question = `Escrow release: ${source.title}`;
  const answer = `Tollgate verified ${source.creator} and released ${releasedReceiptHashes.length} escrowed source payment${releasedReceiptHashes.length === 1 ? "" : "s"} for "${source.title}".`;
  const queryHash = sha256Hex({
    question,
    sourceId: source.id,
    releasedReceiptHashes,
    amountAtomicUsdc,
  });
  const answerHash = sha256Hex({
    answer,
    citations: [citation],
    queryHash,
  });

  return {
    id: sha256Hex({ createdAt, queryHash }).slice(0, 18),
    question,
    answer,
    queryHash,
    answerHash,
    totalAtomicUsdc: amountAtomicUsdc,
    citations: [citation],
    receiptHashes: [],
    createdAt,
  };
}

let escrowReleaseChain: Promise<unknown> = Promise.resolve();

function withEscrowReleaseLock<T>(task: () => Promise<T>): Promise<T> {
  const run = escrowReleaseChain.then(task, task);
  escrowReleaseChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function releaseEscrowForSource(
  source: CreatorSource,
  options: EscrowReleaseOptions = {},
): Promise<EscrowReleaseResult> {
  // Serialized: pending is recomputed inside the lock, so a concurrent
  // release for the same source sees the first release's receipts and
  // cannot pay twice. (Uses its own lock — appendSettlement takes the
  // ledger write lock internally, which is not reentrant.)
  return withEscrowReleaseLock(() =>
    releaseEscrowForSourceUnlocked(source, options),
  );
}

async function releaseEscrowForSourceUnlocked(
  source: CreatorSource,
  options: EscrowReleaseOptions = {},
): Promise<EscrowReleaseResult> {
  const ledger = await readLedger(options.ledgerPath);
  const pending = pendingEscrowReceipts(ledger.receipts, source.id);
  if (pending.length === 0) {
    return {
      released: false,
      amountAtomicUsdc: 0,
      releasedReceiptHashes: [],
    };
  }

  const releasedReceiptHashes = pending.map((receipt) => receipt.receiptHash);
  const amountAtomicUsdc = pending.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );
  const evidence = await routeEscrowReleasePayment(
    source,
    amountAtomicUsdc,
    releasedReceiptHashes,
    options,
  );
  const query = releaseQueryRecord(
    source,
    amountAtomicUsdc,
    releasedReceiptHashes,
    new Date().toISOString(),
  );
  const settlement = await appendSettlement(
    query,
    { [source.id]: evidence },
    options.ledgerPath,
  );

  return {
    released: true,
    amountAtomicUsdc,
    releasedReceiptHashes,
    settlement,
  };
}
