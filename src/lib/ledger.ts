import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Address, Hex } from "viem";
import { sha256Hex } from "./hash";
import type {
  DownloadArchiveEvent,
  LedgerVerification,
  LicenseLedger,
  LicenseReceipt,
  LicenseSettlementEvidence,
  WalletRegistryEntry,
} from "./types";

export const ZERO_HASH = `0x${"0".repeat(64)}` as Hex;

const LEDGER_PATH = path.join(process.cwd(), "data", "ledger.json");
const EMPTY_LEDGER: LicenseLedger = { receipts: [] };

export type LicenseReceiptInput = {
  eventId: Hex;
  event: DownloadArchiveEvent;
  sharedLinkId: string;
  assetId: string;
  ownerId: string;
  photographer: WalletRegistryEntry;
  amountAtomicUsdc: number;
  evidence: LicenseSettlementEvidence;
};

type LicenseReceiptHashPayload = Omit<LicenseReceipt, "id" | "receiptHash">;

function isLedger(value: unknown): value is LicenseLedger {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as Record<string, unknown>).receipts);
}

export async function readLicenseLedger(
  filePath: string = LEDGER_PATH,
): Promise<LicenseLedger> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isLedger(parsed) ? parsed : EMPTY_LEDGER;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return EMPTY_LEDGER;
    throw error;
  }
}

export async function writeLicenseLedger(
  ledger: LicenseLedger,
  filePath: string = LEDGER_PATH,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function receiptPayload(receipt: LicenseReceipt): LicenseReceiptHashPayload {
  const { id, receiptHash, ...payload } = receipt;
  return payload;
}

function createReceipt(
  input: LicenseReceiptInput,
  previousHash: Hex,
): LicenseReceipt {
  const payload: LicenseReceiptHashPayload = {
    eventId: input.eventId,
    assetId: input.assetId,
    sharedLinkId: input.sharedLinkId,
    sharedLinkKeyHash: sha256Hex(input.event.sharedLinkKey),
    ownerId: input.ownerId,
    photographer: input.photographer.displayName,
    wallet: input.photographer.wallet as Address,
    amountAtomicUsdc: input.amountAtomicUsdc,
    settlementMode: input.evidence.settlementMode,
    payer: input.evidence.payer,
    transaction: input.evidence.transaction,
    paymentResource: input.evidence.paymentResource,
    feeRouterSplitId: input.evidence.feeRouterSplitId,
    feeRouterCreateSplitTx: input.evidence.feeRouterCreateSplitTx,
    feeRouterPayTx: input.evidence.feeRouterPayTx,
    rawAccessLogHash: sha256Hex(input.event.rawLine),
    previousHash,
    createdAt: input.event.createdAt,
  };
  const receiptHash = sha256Hex(payload);
  return {
    id: receiptHash.slice(0, 18),
    ...payload,
    receiptHash,
  };
}

export async function appendLicenseReceipt(
  input: LicenseReceiptInput,
  filePath: string = LEDGER_PATH,
): Promise<{ receipt: LicenseReceipt; ledger: LicenseLedger; created: boolean }> {
  const ledger = await readLicenseLedger(filePath);
  const existing = ledger.receipts.find(
    (receipt) => receipt.eventId === input.eventId,
  );
  if (existing) return { receipt: existing, ledger, created: false };

  const previousHash = ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH;
  const receipt = createReceipt(input, previousHash);
  const nextLedger = { receipts: [...ledger.receipts, receipt] };
  await writeLicenseLedger(nextLedger, filePath);
  return { receipt, ledger: nextLedger, created: true };
}

export function verifyLicenseLedger(
  ledger: LicenseLedger,
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

export function summarizeLedger(ledger: LicenseLedger) {
  const byWallet = new Map<
    Address,
    { wallet: Address; photographer: string; resolves: number; earned: number }
  >();
  for (const receipt of ledger.receipts) {
    const current = byWallet.get(receipt.wallet) ?? {
      wallet: receipt.wallet,
      photographer: receipt.photographer,
      resolves: 0,
      earned: 0,
    };
    current.resolves += 1;
    current.earned += receipt.amountAtomicUsdc;
    byWallet.set(receipt.wallet, current);
  }
  return Array.from(byWallet.values()).sort((a, b) => b.earned - a.earned);
}
