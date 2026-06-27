import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "./hash";
import type {
  AnswerEvidence,
  CreatorEarnings,
  CreatorEvidence,
  JudgeDemoEvidence,
  Ledger,
  LedgerVerification,
  PaymentReceipt,
  QueryRecord,
  ReceiptEvidence,
  SettlementResult,
  TrackRecordEvidence,
  SourceEarnings,
  SourceEvidence,
} from "./types";

const EMPTY_LEDGER: Ledger = { queries: [], receipts: [] };
export const ZERO_HASH = `0x${"0".repeat(64)}`;
const LEDGER_PATH = path.join(process.cwd(), "data", "ledger.json");
const SOURCE_ACCESS_PREFIX = "Paid source access:";

type ReceiptHashPayload = {
  queryId: string;
  sourceId: string;
  creator: string;
  wallet: `0x${string}`;
  amountAtomicUsdc: number;
  settlementMode: PaymentReceipt["settlementMode"];
  queryPaymentHash?: string;
  payer?: string;
  transaction?: string;
  paymentResource?: string;
  feeRouterSplitId?: string;
  feeRouterCreateSplitTx?: string;
  feeRouterPayTx?: string;
  previousHash: string;
  createdAt: string;
};

function isLedger(value: unknown): value is Ledger {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.queries) && Array.isArray(record.receipts);
}

export async function readLedger(): Promise<Ledger> {
  try {
    const raw = await readFile(LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isLedger(parsed)) return EMPTY_LEDGER;
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_LEDGER;
    throw error;
  }
}

export async function writeLedger(ledger: Ledger): Promise<void> {
  await mkdir(path.dirname(LEDGER_PATH), { recursive: true });
  const tmpPath = `${LEDGER_PATH}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(tmpPath, LEDGER_PATH);
}

function buildReceiptPayload(
  queryId: string,
  sourceId: string,
  creator: string,
  wallet: `0x${string}`,
  amountAtomicUsdc: number,
  evidence: ReceiptEvidence,
  previousHash: string,
  createdAt: string,
): ReceiptHashPayload {
  const payload: ReceiptHashPayload = {
    queryId,
    sourceId,
    creator,
    wallet,
    amountAtomicUsdc,
    settlementMode: evidence.settlementMode,
    previousHash,
    createdAt,
  };
  if (evidence.payer !== undefined) payload.payer = evidence.payer;
  if (evidence.transaction !== undefined) {
    payload.transaction = evidence.transaction;
  }
  if (evidence.paymentResource !== undefined) {
    payload.paymentResource = evidence.paymentResource;
  }
  if (evidence.feeRouterSplitId !== undefined) {
    payload.feeRouterSplitId = evidence.feeRouterSplitId;
  }
  if (evidence.feeRouterCreateSplitTx !== undefined) {
    payload.feeRouterCreateSplitTx = evidence.feeRouterCreateSplitTx;
  }
  if (evidence.feeRouterPayTx !== undefined) {
    payload.feeRouterPayTx = evidence.feeRouterPayTx;
  }
  return payload;
}

function withQueryPaymentHash(
  payload: ReceiptHashPayload,
  query: QueryRecord,
): ReceiptHashPayload {
  if (!query.readerPayment) return payload;
  return {
    ...payload,
    queryPaymentHash: query.readerPayment.paymentHash,
  };
}

function payloadFromReceipt(
  receipt: PaymentReceipt,
  includeUndefinedOptionals: boolean,
): ReceiptHashPayload {
  const payload: ReceiptHashPayload = {
    queryId: receipt.queryId,
    sourceId: receipt.sourceId,
    creator: receipt.creator,
    wallet: receipt.wallet,
    amountAtomicUsdc: receipt.amountAtomicUsdc,
    settlementMode: receipt.settlementMode,
    previousHash: receipt.previousHash,
    createdAt: receipt.createdAt,
  };
  if (receipt.queryPaymentHash !== undefined) {
    payload.queryPaymentHash = receipt.queryPaymentHash;
  }
  if (includeUndefinedOptionals || receipt.payer !== undefined) {
    payload.payer = receipt.payer;
  }
  if (includeUndefinedOptionals || receipt.transaction !== undefined) {
    payload.transaction = receipt.transaction;
  }
  if (includeUndefinedOptionals || receipt.paymentResource !== undefined) {
    payload.paymentResource = receipt.paymentResource;
  }
  if (receipt.feeRouterSplitId !== undefined) {
    payload.feeRouterSplitId = receipt.feeRouterSplitId;
  }
  if (receipt.feeRouterCreateSplitTx !== undefined) {
    payload.feeRouterCreateSplitTx = receipt.feeRouterCreateSplitTx;
  }
  if (receipt.feeRouterPayTx !== undefined) {
    payload.feeRouterPayTx = receipt.feeRouterPayTx;
  }
  return payload;
}

function queryPaymentPayload(
  query: QueryRecord,
  includeUndefinedOptionals: boolean,
): unknown {
  if (!query.readerPayment) return null;
  const payload: Omit<
    NonNullable<QueryRecord["readerPayment"]>,
    "paymentHash"
  > = {
    amountAtomicUsdc: query.readerPayment.amountAtomicUsdc,
    settlementMode: query.readerPayment.settlementMode,
    payTo: query.readerPayment.payTo,
    paymentResource: query.readerPayment.paymentResource,
  };
  if (includeUndefinedOptionals || query.readerPayment.payer !== undefined) {
    payload.payer = query.readerPayment.payer;
  }
  if (
    includeUndefinedOptionals ||
    query.readerPayment.transaction !== undefined
  ) {
    payload.transaction = query.readerPayment.transaction;
  }
  return payload;
}

export function createReceipts(
  query: QueryRecord,
  existingReceipts: PaymentReceipt[],
  evidenceBySourceId: Record<string, ReceiptEvidence> = {},
): PaymentReceipt[] {
  let previousHash = existingReceipts.at(-1)?.receiptHash ?? ZERO_HASH;

  return query.citations.map((citation) => {
    const evidence = evidenceBySourceId[citation.sourceId] ?? {
      settlementMode: "local-proof" as const,
      paymentResource: `/api/sources/${citation.sourceId}`,
    };
    const unsigned = withQueryPaymentHash(
      buildReceiptPayload(
        query.id,
        citation.sourceId,
        citation.creator,
        citation.wallet,
        citation.amountAtomicUsdc,
        {
          ...evidence,
          paymentResource:
            evidence.paymentResource ?? `/api/sources/${citation.sourceId}`,
        },
        previousHash,
        query.createdAt,
      ),
      query,
    );
    const receiptHash = sha256Hex(unsigned);
    const receipt: PaymentReceipt = {
      id: receiptHash.slice(0, 18),
      ...unsigned,
      receiptHash,
    };
    previousHash = receiptHash;
    return receipt;
  });
}

export async function appendSettlement(
  query: QueryRecord,
  evidenceBySourceId: Record<string, ReceiptEvidence> = {},
): Promise<SettlementResult> {
  const ledger = await readLedger();
  const receipts = createReceipts(query, ledger.receipts, evidenceBySourceId);
  const queryWithReceipts: QueryRecord = {
    ...query,
    receiptHashes: receipts.map((receipt) => receipt.receiptHash),
  };
  const nextLedger: Ledger = {
    queries: [queryWithReceipts, ...ledger.queries],
    receipts: [...ledger.receipts, ...receipts],
  };
  await writeLedger(nextLedger);
  return { query: queryWithReceipts, receipts, ledger: nextLedger };
}

export async function attachTrackRecordEvidence(
  queryId: string,
  trackRecord: TrackRecordEvidence,
): Promise<Ledger> {
  const ledger = await readLedger();
  const queryExists = ledger.queries.some((query) => query.id === queryId);
  if (!queryExists) {
    throw new Error(
      `Cannot attach TrackRecord evidence to missing query ${queryId}.`,
    );
  }

  const nextLedger: Ledger = {
    ...ledger,
    queries: ledger.queries.map((query) =>
      query.id === queryId ? { ...query, trackRecord } : query,
    ),
  };
  await writeLedger(nextLedger);
  return nextLedger;
}

export function summarizeCreators(ledger: Ledger): CreatorEarnings[] {
  const byWallet = new Map<string, CreatorEarnings>();
  const sourceIdsByWallet = new Map<string, Set<string>>();

  for (const query of ledger.queries) {
    for (const citation of query.citations) {
      const current = byWallet.get(citation.wallet) ?? {
        creator: citation.creator,
        handle: citation.handle,
        wallet: citation.wallet,
        sourceCount: 0,
        citationCount: 0,
        earnedAtomicUsdc: 0,
      };
      current.citationCount += 1;
      current.earnedAtomicUsdc += citation.amountAtomicUsdc;
      byWallet.set(citation.wallet, current);

      const sourceIds = sourceIdsByWallet.get(citation.wallet) ?? new Set();
      sourceIds.add(citation.sourceId);
      sourceIdsByWallet.set(citation.wallet, sourceIds);
    }
  }

  return Array.from(byWallet.values())
    .map((creator) => ({
      ...creator,
      sourceCount: sourceIdsByWallet.get(creator.wallet)?.size ?? 0,
    }))
    .sort((a, b) => b.earnedAtomicUsdc - a.earnedAtomicUsdc);
}

function latestFirst<T extends { createdAt: string }>(items: T[]): T[] {
  return items
    .slice()
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
}

function queriesForReceipts(
  ledger: Ledger,
  receipts: PaymentReceipt[],
): QueryRecord[] {
  const queryIds = new Set(receipts.map((receipt) => receipt.queryId));
  return latestFirst(ledger.queries.filter((query) => queryIds.has(query.id)));
}

function isSourceAccessQuery(query: QueryRecord): boolean {
  return query.question.startsWith(SOURCE_ACCESS_PREFIX);
}

export function getCreatorEvidence(
  ledger: Ledger,
  wallet: string,
): CreatorEvidence | null {
  const normalizedWallet = wallet.toLowerCase();
  const receipts = latestFirst(
    ledger.receipts.filter(
      (receipt) => receipt.wallet.toLowerCase() === normalizedWallet,
    ),
  );
  if (receipts.length === 0) return null;

  const latestReceipt = receipts[0];
  const sourceStats = new Map<string, SourceEarnings>();

  for (const receipt of receipts) {
    const current = sourceStats.get(receipt.sourceId) ?? {
      sourceId: receipt.sourceId,
      title: receipt.sourceId,
      creator: receipt.creator,
      wallet: receipt.wallet,
      citationCount: 0,
      earnedAtomicUsdc: 0,
    };
    const query = ledger.queries.find(
      (candidate) => candidate.id === receipt.queryId,
    );
    const citation = query?.citations.find(
      (candidate) => candidate.sourceId === receipt.sourceId,
    );
    current.title = citation?.title ?? current.title;
    current.citationCount += 1;
    current.earnedAtomicUsdc += receipt.amountAtomicUsdc;
    sourceStats.set(receipt.sourceId, current);
  }

  return {
    creator: latestReceipt.creator,
    handle:
      ledger.queries
        .flatMap((query) => query.citations)
        .find((citation) => citation.wallet.toLowerCase() === normalizedWallet)
        ?.handle ?? "@unknown",
    wallet: latestReceipt.wallet,
    sourceCount: sourceStats.size,
    citationCount: receipts.length,
    earnedAtomicUsdc: receipts.reduce(
      (sum, receipt) => sum + receipt.amountAtomicUsdc,
      0,
    ),
    receipts,
    queries: queriesForReceipts(ledger, receipts),
    sources: Array.from(sourceStats.values()).sort(
      (a, b) => b.earnedAtomicUsdc - a.earnedAtomicUsdc,
    ),
  };
}

export function getSourceEvidence(
  ledger: Ledger,
  sourceId: string,
): SourceEvidence | null {
  const receipts = latestFirst(
    ledger.receipts.filter((receipt) => receipt.sourceId === sourceId),
  );
  if (receipts.length === 0) return null;

  const latestReceipt = receipts[0];
  const query = ledger.queries.find(
    (candidate) => candidate.id === latestReceipt.queryId,
  );
  const citation = query?.citations.find(
    (candidate) => candidate.sourceId === sourceId,
  );

  return {
    sourceId,
    title: citation?.title ?? sourceId,
    creator: latestReceipt.creator,
    wallet: latestReceipt.wallet,
    citationCount: receipts.length,
    earnedAtomicUsdc: receipts.reduce(
      (sum, receipt) => sum + receipt.amountAtomicUsdc,
      0,
    ),
    receipts,
    queries: queriesForReceipts(ledger, receipts),
  };
}

export function getAnswerEvidence(
  ledger: Ledger,
  queryIdOrHash: string,
): AnswerEvidence | null {
  const query = ledger.queries.find(
    (candidate) =>
      candidate.id === queryIdOrHash ||
      candidate.queryHash === queryIdOrHash ||
      candidate.answerHash === queryIdOrHash,
  );
  if (!query) return null;

  const receiptHashes = new Set(query.receiptHashes);
  const receipts = latestFirst(
    ledger.receipts.filter(
      (receipt) =>
        receipt.queryId === query.id || receiptHashes.has(receipt.receiptHash),
    ),
  );

  return { query, receipts };
}

export function getJudgeDemoEvidence(ledger: Ledger): JudgeDemoEvidence {
  const queries = latestFirst(ledger.queries);
  const localQuery =
    queries.find(
      (query) => !query.readerPayment && !isSourceAccessQuery(query),
    ) ?? null;
  const paidQuery = queries.find((query) => query.readerPayment) ?? null;
  const sourcePurchaseEvidences = queries
    .filter(isSourceAccessQuery)
    .map((query) => getAnswerEvidence(ledger, query.id))
    .filter((evidence): evidence is AnswerEvidence => evidence !== null);
  const sourcePurchase =
    sourcePurchaseEvidences.find((evidence) =>
      evidence.receipts.some(
        (receipt) => receipt.settlementMode !== "local-proof",
      ),
    ) ??
    sourcePurchaseEvidences[0] ??
    null;

  return {
    localAnswer: localQuery ? getAnswerEvidence(ledger, localQuery.id) : null,
    paidAnswer: paidQuery ? getAnswerEvidence(ledger, paidQuery.id) : null,
    sourcePurchase,
  };
}

export function verifyLedgerIntegrity(ledger: Ledger): LedgerVerification {
  const issues: LedgerVerification["issues"] = [];
  const receiptHashes = new Set(
    ledger.receipts.map((receipt) => receipt.receiptHash),
  );
  const queryIds = new Set(ledger.queries.map((query) => query.id));
  let expectedPreviousHash = ZERO_HASH;

  ledger.receipts.forEach((receipt, index) => {
    if (receipt.previousHash !== expectedPreviousHash) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "previousHash does not match the prior receipt.",
      });
    }

    const storedShapeHash = sha256Hex(payloadFromReceipt(receipt, false));
    const legacyUndefinedHash = sha256Hex(payloadFromReceipt(receipt, true));
    if (
      receipt.receiptHash !== storedShapeHash &&
      receipt.receiptHash !== legacyUndefinedHash
    ) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "receiptHash does not match the stored receipt payload.",
      });
    }

    if (!queryIds.has(receipt.queryId)) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "receipt references a missing query.",
      });
    }

    expectedPreviousHash = receipt.receiptHash;
  });

  ledger.queries.forEach((query) => {
    if (
      query.readerPayment &&
      sha256Hex(queryPaymentPayload(query, false)) !==
        query.readerPayment.paymentHash &&
      sha256Hex(queryPaymentPayload(query, true)) !==
        query.readerPayment.paymentHash
    ) {
      issues.push({
        index: -1,
        receiptHash: query.readerPayment.paymentHash,
        reason: `query ${query.id} has an invalid reader payment hash.`,
      });
    }

    query.receiptHashes.forEach((receiptHash) => {
      if (!receiptHashes.has(receiptHash)) {
        issues.push({
          index: -1,
          receiptHash,
          reason: `query ${query.id} references a missing receipt.`,
        });
      }
    });
  });

  return {
    ok: issues.length === 0,
    receiptCount: ledger.receipts.length,
    queryCount: ledger.queries.length,
    latestHash: ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH,
    issues,
  };
}
