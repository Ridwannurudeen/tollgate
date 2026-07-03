import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "./hash.js";
import type {
  Hex,
  LedgerVerification,
  PlaybackLedger,
  PlaybackReceipt,
} from "./types.js";

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;
const EMPTY_LEDGER: PlaybackLedger = { receipts: [] };
let ledgerWriteLock: Promise<void> = Promise.resolve();

export type PlaybackReceiptInput = Omit<
  PlaybackReceipt,
  "id" | "previousHash" | "receiptHash" | "createdAt"
>;

type ReceiptHashPayload = Omit<PlaybackReceipt, "id" | "receiptHash">;

function isLedger(value: unknown): value is PlaybackLedger {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as Record<string, unknown>).receipts);
}

function withLedgerWriteLock<T>(write: () => Promise<T>): Promise<T> {
  const run = ledgerWriteLock.then(write, write);
  ledgerWriteLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function receiptPayload(receipt: PlaybackReceipt): ReceiptHashPayload {
  const { id, receiptHash, ...payload } = receipt;
  return payload;
}

function createReceipt(
  input: PlaybackReceiptInput,
  previousHash: Hex,
): PlaybackReceipt {
  const payload: ReceiptHashPayload = {
    ...input,
    previousHash,
    createdAt: new Date().toISOString(),
  };
  const receiptHash = sha256Hex(payload);
  return {
    id: receiptHash.slice(0, 18),
    ...payload,
    receiptHash,
  };
}

export async function readPlaybackLedger(
  filePath: string,
): Promise<PlaybackLedger> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isLedger(parsed) ? parsed : EMPTY_LEDGER;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_LEDGER;
    throw error;
  }
}

export async function writePlaybackLedger(
  ledger: PlaybackLedger,
  filePath: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

export async function appendPlaybackReceipt(
  input: PlaybackReceiptInput,
  filePath: string,
): Promise<{ receipt: PlaybackReceipt; ledger: PlaybackLedger; created: boolean }> {
  return withLedgerWriteLock(async () => {
    const ledger = await readPlaybackLedger(filePath);
    const existing = ledger.receipts.find(
      (receipt) => receipt.eventId === input.eventId,
    );
    if (existing) return { receipt: existing, ledger, created: false };

    const previousHash = ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH;
    const receipt = createReceipt(input, previousHash);
    const nextLedger = { receipts: [...ledger.receipts, receipt] };
    await writePlaybackLedger(nextLedger, filePath);
    return { receipt, ledger: nextLedger, created: true };
  });
}

export function verifyPlaybackLedger(
  ledger: PlaybackLedger,
): LedgerVerification {
  const issues: LedgerVerification["issues"] = [];
  let expectedPreviousHash = ZERO_HASH;

  ledger.receipts.forEach((receipt, index) => {
    if (receipt.previousHash !== expectedPreviousHash) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "previousHash does not match the prior receipt.",
      });
    }
    if (sha256Hex(receiptPayload(receipt)) !== receipt.receiptHash) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "receiptHash does not match the stored receipt payload.",
      });
    }
    expectedPreviousHash = receipt.receiptHash;
  });

  return {
    ok: issues.length === 0,
    receiptCount: ledger.receipts.length,
    latestHash: ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH,
    issues,
  };
}
