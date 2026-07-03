import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { sha256Hex } from "./hash";
import { notifyCreatorReceipts } from "./notify";
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
const LEDGER_DB_PATH = path.join(process.cwd(), "data", "ledger.db");
const SOURCE_ACCESS_PREFIX = "Paid source access:";
let ledgerWriteLock: Promise<void> = Promise.resolve();

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
  canonicalUrl?: string;
  sourceContentHash?: string;
  sourceExcerptHash?: string;
  contentFetchedAt?: string;
  ownershipProof?: PaymentReceipt["ownershipProof"];
  payoutPolicy?: PaymentReceipt["payoutPolicy"];
  contributors?: PaymentReceipt["contributors"];
  releasedReceiptHashes?: string[];
  refundReason?: string;
  previousHash: string;
  createdAt: string;
};

function isLedger(value: unknown): value is Ledger {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.queries) && Array.isArray(record.receipts);
}

export async function readLedger(
  filePath: string = LEDGER_PATH,
): Promise<Ledger> {
  const dbPath = sqlitePathForLedger(filePath);
  if (await fileExists(dbPath)) {
    return readSqliteLedger(dbPath);
  }
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isLedger(parsed)) return EMPTY_LEDGER;
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_LEDGER;
    throw error;
  }
}

export async function writeLedger(
  ledger: Ledger,
  filePath: string = LEDGER_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function withLedgerWriteLock<T>(write: () => Promise<T>): Promise<T> {
  const run = ledgerWriteLock.then(write, write);
  ledgerWriteLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function sqlitePathForLedger(filePath: string): string {
  if (filePath === LEDGER_PATH) return LEDGER_DB_PATH;
  return filePath.endsWith(".json")
    ? `${filePath.slice(0, -".json".length)}.db`
    : `${filePath}.db`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return false;
    throw error;
  }
}

async function openLedgerDatabase(dbPath: string): Promise<DatabaseSync> {
  const sqlite = await import("node:sqlite").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `SQLite ledger requires Node with node:sqlite support: ${message}`,
    );
  });
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS queries (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipts (
      receipt_hash TEXT PRIMARY KEY,
      query_id TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reader_payments (
      payment_hash TEXT PRIMARY KEY,
      query_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);
  return db;
}

function parseLedgerRow<T>(row: { payload_json: string }): T {
  return JSON.parse(row.payload_json) as T;
}

async function readSqliteLedger(dbPath: string): Promise<Ledger> {
  const db = await openLedgerDatabase(dbPath);
  try {
    const queries = db
      .prepare("SELECT payload_json FROM queries ORDER BY rowid DESC")
      .all()
      .map((row) => parseLedgerRow<QueryRecord>(row as { payload_json: string }));
    const receipts = db
      .prepare("SELECT payload_json FROM receipts ORDER BY rowid ASC")
      .all()
      .map((row) =>
        parseLedgerRow<PaymentReceipt>(row as { payload_json: string }),
      );
    return { queries, receipts };
  } finally {
    db.close();
  }
}

async function appendSqliteSettlement(
  dbPath: string,
  query: QueryRecord,
  receipts: PaymentReceipt[],
): Promise<void> {
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = await openLedgerDatabase(dbPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      "INSERT INTO queries (id, created_at, payload_json) VALUES (?, ?, ?)",
    ).run(query.id, query.createdAt, JSON.stringify(query));
    if (query.readerPayment) {
      db.prepare(
        "INSERT OR IGNORE INTO reader_payments (payment_hash, query_id, payload_json) VALUES (?, ?, ?)",
      ).run(
        query.readerPayment.paymentHash,
        query.id,
        JSON.stringify(query.readerPayment),
      );
    }
    const insertReceipt = db.prepare(
      "INSERT INTO receipts (receipt_hash, query_id, previous_hash, created_at, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const receipt of receipts) {
      insertReceipt.run(
        receipt.receiptHash,
        receipt.queryId,
        receipt.previousHash,
        receipt.createdAt,
        JSON.stringify(receipt),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

async function updateSqliteQuery(
  dbPath: string,
  query: QueryRecord,
): Promise<void> {
  const db = await openLedgerDatabase(dbPath);
  try {
    db.prepare("UPDATE queries SET payload_json = ? WHERE id = ?").run(
      JSON.stringify(query),
      query.id,
    );
  } finally {
    db.close();
  }
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
  if (evidence.canonicalUrl !== undefined) {
    payload.canonicalUrl = evidence.canonicalUrl;
  }
  if (evidence.sourceContentHash !== undefined) {
    payload.sourceContentHash = evidence.sourceContentHash;
  }
  if (evidence.sourceExcerptHash !== undefined) {
    payload.sourceExcerptHash = evidence.sourceExcerptHash;
  }
  if (evidence.contentFetchedAt !== undefined) {
    payload.contentFetchedAt = evidence.contentFetchedAt;
  }
  if (evidence.ownershipProof !== undefined) {
    payload.ownershipProof = evidence.ownershipProof;
  }
  if (evidence.payoutPolicy !== undefined) {
    payload.payoutPolicy = evidence.payoutPolicy;
  }
  if (evidence.contributors !== undefined) {
    payload.contributors = evidence.contributors;
  }
  if (evidence.releasedReceiptHashes !== undefined) {
    payload.releasedReceiptHashes = evidence.releasedReceiptHashes;
  }
  if (evidence.refundReason !== undefined) {
    payload.refundReason = evidence.refundReason;
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

function legacyStableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => legacyStableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${legacyStableStringify(record[key])}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function legacySha256Hex(value: unknown): string {
  return `0x${createHash("sha256").update(legacyStableStringify(value)).digest("hex")}`;
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
  if (receipt.canonicalUrl !== undefined) {
    payload.canonicalUrl = receipt.canonicalUrl;
  }
  if (receipt.sourceContentHash !== undefined) {
    payload.sourceContentHash = receipt.sourceContentHash;
  }
  if (receipt.sourceExcerptHash !== undefined) {
    payload.sourceExcerptHash = receipt.sourceExcerptHash;
  }
  if (receipt.contentFetchedAt !== undefined) {
    payload.contentFetchedAt = receipt.contentFetchedAt;
  }
  if (receipt.ownershipProof !== undefined) {
    payload.ownershipProof = receipt.ownershipProof;
  }
  if (receipt.payoutPolicy !== undefined) {
    payload.payoutPolicy = receipt.payoutPolicy;
  }
  if (receipt.contributors !== undefined) {
    payload.contributors = receipt.contributors;
  }
  if (receipt.releasedReceiptHashes !== undefined) {
    payload.releasedReceiptHashes = receipt.releasedReceiptHashes;
  }
  if (receipt.refundReason !== undefined) {
    payload.refundReason = receipt.refundReason;
  }
  return payload;
}

function legacyX402SourceAccessReceiptPayload(
  receipt: PaymentReceipt,
): unknown {
  return {
    queryId: receipt.queryId,
    sourceId: receipt.sourceId,
    creator: receipt.creator,
    wallet: receipt.wallet,
    amountAtomicUsdc: receipt.amountAtomicUsdc,
    settlementMode: receipt.settlementMode,
    payer: receipt.payer,
    transaction: receipt.transaction,
    paymentResource: receipt.paymentResource,
    previousHash: receipt.previousHash,
    createdAt: receipt.createdAt,
  };
}

function receiptHashCandidates(receipt: PaymentReceipt): string[] {
  return [
    sha256Hex(payloadFromReceipt(receipt, false)),
    sha256Hex(payloadFromReceipt(receipt, true)),
    legacySha256Hex(legacyX402SourceAccessReceiptPayload(receipt)),
  ];
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

function legacyQueryPaymentPayload(query: QueryRecord): unknown {
  if (!query.readerPayment) return null;
  return {
    amountAtomicUsdc: query.readerPayment.amountAtomicUsdc,
    settlementMode: query.readerPayment.settlementMode,
    payTo: query.readerPayment.payTo,
    paymentResource: query.readerPayment.paymentResource,
    payer: query.readerPayment.payer,
    transaction: query.readerPayment.transaction,
  };
}

function queryPaymentHashCandidates(query: QueryRecord): string[] {
  if (!query.readerPayment) return [];
  return [
    sha256Hex(queryPaymentPayload(query, false)),
    sha256Hex(queryPaymentPayload(query, true)),
    legacySha256Hex(legacyQueryPaymentPayload(query)),
  ];
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
          canonicalUrl: evidence.canonicalUrl ?? citation.canonicalUrl,
          sourceContentHash:
            evidence.sourceContentHash ?? citation.sourceContentHash,
          sourceExcerptHash:
            evidence.sourceExcerptHash ?? citation.sourceExcerptHash,
          contentFetchedAt:
            evidence.contentFetchedAt ?? citation.contentFetchedAt,
          ownershipProof: evidence.ownershipProof ?? citation.ownershipProof,
          contributors: evidence.contributors ?? citation.contributors,
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
  filePath: string = LEDGER_PATH,
): Promise<SettlementResult> {
  return withLedgerWriteLock(async () => {
    const ledger = await readLedger(filePath);
    const queryWithPayoutPolicy: QueryRecord = {
      ...query,
      citations: query.citations.map((citation) => {
        const evidence = evidenceBySourceId[citation.sourceId];
        if (!evidence?.payoutPolicy) return citation;
        return { ...citation, payoutPolicy: evidence.payoutPolicy };
      }),
    };
    const receipts = createReceipts(query, ledger.receipts, evidenceBySourceId);
    const queryWithReceipts: QueryRecord = {
      ...queryWithPayoutPolicy,
      receiptHashes: receipts.map((receipt) => receipt.receiptHash),
    };
    const nextLedger: Ledger = {
      queries: [queryWithReceipts, ...ledger.queries],
      receipts: [...ledger.receipts, ...receipts],
    };
    const dbPath = sqlitePathForLedger(filePath);
    if (await fileExists(dbPath)) {
      await appendSqliteSettlement(dbPath, queryWithReceipts, receipts);
    } else {
      await writeLedger(nextLedger, filePath);
    }
    await notifyCreatorReceipts(queryWithReceipts, receipts).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`Creator notification failed: ${message}`);
    });
    return { query: queryWithReceipts, receipts, ledger: nextLedger };
  });
}

export async function attachTrackRecordEvidence(
  queryId: string,
  trackRecord: TrackRecordEvidence,
  filePath: string = LEDGER_PATH,
): Promise<Ledger> {
  return withLedgerWriteLock(async () => {
    const ledger = await readLedger(filePath);
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
    const dbPath = sqlitePathForLedger(filePath);
    if (await fileExists(dbPath)) {
      const updated = nextLedger.queries.find((query) => query.id === queryId);
      if (updated) await updateSqliteQuery(dbPath, updated);
    } else {
      await writeLedger(nextLedger, filePath);
    }
    return nextLedger;
  });
}

function isCreatorEarnedReceipt(receipt: PaymentReceipt): boolean {
  return (
    receipt.settlementMode !== "escrowed" &&
    receipt.settlementMode !== "refunded"
  );
}

export function summarizeCreators(ledger: Ledger): CreatorEarnings[] {
  const byWallet = new Map<string, CreatorEarnings>();
  const sourceIdsByWallet = new Map<string, Set<string>>();

  const queryById = new Map(ledger.queries.map((query) => [query.id, query]));
  for (const receipt of ledger.receipts) {
    if (!isCreatorEarnedReceipt(receipt)) continue;
    const query = queryById.get(receipt.queryId);
    const citation = query?.citations.find(
      (candidate) => candidate.sourceId === receipt.sourceId,
    );
    const current = byWallet.get(receipt.wallet) ?? {
        creator: receipt.creator,
        handle: citation?.handle ?? "@unknown",
        wallet: receipt.wallet,
        sourceCount: 0,
        citationCount: 0,
        earnedAtomicUsdc: 0,
    };
    current.citationCount += 1;
    current.earnedAtomicUsdc += receipt.amountAtomicUsdc;
    byWallet.set(receipt.wallet, current);

    const sourceIds = sourceIdsByWallet.get(receipt.wallet) ?? new Set();
    sourceIds.add(receipt.sourceId);
    sourceIdsByWallet.set(receipt.wallet, sourceIds);
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

  const queryById = new Map<string, QueryRecord>();
  let handle: string | undefined;
  for (const query of ledger.queries) {
    queryById.set(query.id, query);
    if (handle === undefined) {
      const match = query.citations.find(
        (citation) => citation.wallet.toLowerCase() === normalizedWallet,
      );
      if (match) handle = match.handle;
    }
  }

  for (const receipt of receipts) {
    const current = sourceStats.get(receipt.sourceId) ?? {
      sourceId: receipt.sourceId,
      title: receipt.sourceId,
      creator: receipt.creator,
      wallet: receipt.wallet,
      citationCount: 0,
      earnedAtomicUsdc: 0,
    };
    const query = queryById.get(receipt.queryId);
    const citation = query?.citations.find(
      (candidate) => candidate.sourceId === receipt.sourceId,
    );
    current.title = citation?.title ?? current.title;
    current.citationCount += isCreatorEarnedReceipt(receipt) ? 1 : 0;
    current.earnedAtomicUsdc += isCreatorEarnedReceipt(receipt)
      ? receipt.amountAtomicUsdc
      : 0;
    sourceStats.set(receipt.sourceId, current);
  }

  return {
    creator: latestReceipt.creator,
    handle: handle ?? "@unknown",
    wallet: latestReceipt.wallet,
    sourceCount: sourceStats.size,
    citationCount: receipts.filter(isCreatorEarnedReceipt).length,
    earnedAtomicUsdc: receipts.reduce(
      (sum, receipt) =>
        sum + (isCreatorEarnedReceipt(receipt) ? receipt.amountAtomicUsdc : 0),
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
    citationCount: receipts.filter(isCreatorEarnedReceipt).length,
    earnedAtomicUsdc: receipts.reduce(
      (sum, receipt) =>
        sum + (isCreatorEarnedReceipt(receipt) ? receipt.amountAtomicUsdc : 0),
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

    if (!receiptHashCandidates(receipt).includes(receipt.receiptHash)) {
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
      !queryPaymentHashCandidates(query).includes(
        query.readerPayment.paymentHash,
      )
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
