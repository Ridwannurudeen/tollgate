"use strict";

const { createHash } = require("node:crypto");

// Deterministic JSON: sorted keys, undefined values dropped, so two logically
// equal receipts always hash identically.
function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

function sha256Hex(input) {
  return `0x${createHash("sha256").update(input).digest("hex")}`;
}

const GENESIS_HASH = `0x${"0".repeat(64)}`;
const RECEIPTS_KEY = "tollgate:receipts";

async function readReceipts(storage) {
  const stored = await storage.get(RECEIPTS_KEY);
  return Array.isArray(stored) ? stored : [];
}

// Append a hash-linked receipt. eventId makes appends idempotent: if a receipt
// already exists for the same settlement event, the existing one is returned
// and no duplicate is written.
async function appendReceipt(storage, input) {
  const receipts = await readReceipts(storage);
  const existing = receipts.find(
    (receipt) => receipt.eventId === input.eventId,
  );
  if (existing) return { receipt: existing, created: false };

  const previousHash =
    receipts.length > 0
      ? receipts[receipts.length - 1].receiptHash
      : GENESIS_HASH;
  const payload = {
    eventId: input.eventId,
    videoId: input.videoId,
    videoName: input.videoName,
    creatorWallet: input.creatorWallet,
    amountAtomicUsdc: input.amountAtomicUsdc,
    settlementMode: input.settlementMode,
    transaction: input.transaction,
    feeRouterSplitId: input.feeRouterSplitId,
    createdAt: input.createdAt,
    previousHash,
  };
  const receipt = {
    ...payload,
    receiptHash: sha256Hex(stableStringify(payload)),
  };
  await storage.set(RECEIPTS_KEY, [...receipts, receipt]);
  return { receipt, created: true };
}

function verifyChain(receipts) {
  let previousHash = GENESIS_HASH;
  for (const receipt of receipts) {
    if (receipt.previousHash !== previousHash) {
      return {
        ok: false,
        brokenAt: receipt.eventId,
        reason: "previousHash mismatch",
      };
    }
    const { receiptHash, ...payload } = receipt;
    if (sha256Hex(stableStringify(payload)) !== receiptHash) {
      return {
        ok: false,
        brokenAt: receipt.eventId,
        reason: "receiptHash mismatch",
      };
    }
    previousHash = receiptHash;
  }
  return { ok: true };
}

module.exports = {
  stableStringify,
  sha256Hex,
  readReceipts,
  appendReceipt,
  verifyChain,
  GENESIS_HASH,
  RECEIPTS_KEY,
};
