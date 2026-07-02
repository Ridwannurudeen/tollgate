import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const ledgerPath = new URL("../data/ledger.json", import.meta.url);

function stableStringify(value) {
  if (value === undefined) return "null";

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256Hex(value) {
  return `0x${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function legacyStableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => legacyStableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${legacyStableStringify(value[key])}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function legacySha256Hex(value) {
  return `0x${createHash("sha256").update(legacyStableStringify(value)).digest("hex")}`;
}

function receiptPayload(receipt, includeUndefinedOptionals) {
  const payload = {
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
  return payload;
}

function legacyX402SourceAccessReceiptPayload(receipt) {
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

function receiptHashCandidates(receipt) {
  return [
    sha256Hex(receiptPayload(receipt, false)),
    sha256Hex(receiptPayload(receipt, true)),
    legacySha256Hex(legacyX402SourceAccessReceiptPayload(receipt)),
  ];
}

function queryPaymentPayload(query, includeUndefinedOptionals) {
  if (!query.readerPayment) return null;
  const payload = {
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

function legacyQueryPaymentPayload(query) {
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

function queryPaymentHashCandidates(query) {
  if (!query.readerPayment) return [];
  return [
    sha256Hex(queryPaymentPayload(query, false)),
    sha256Hex(queryPaymentPayload(query, true)),
    legacySha256Hex(legacyQueryPaymentPayload(query)),
  ];
}

function verifyLedger(ledger) {
  const issues = [];
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
        reason: "previousHash does not match prior receipt",
      });
    }

    if (!receiptHashCandidates(receipt).includes(receipt.receiptHash)) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "receiptHash does not match payload",
      });
    }

    if (!queryIds.has(receipt.queryId)) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "receipt references missing query",
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
        reason: `query ${query.id} has invalid reader payment hash`,
      });
    }

    query.receiptHashes.forEach((receiptHash) => {
      if (!receiptHashes.has(receiptHash)) {
        issues.push({
          index: -1,
          receiptHash,
          reason: `query ${query.id} references missing receipt`,
        });
      }
    });
  });

  return {
    ok: issues.length === 0,
    queryCount: ledger.queries.length,
    receiptCount: ledger.receipts.length,
    latestHash: ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH,
    issues,
  };
}

const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
const result = verifyLedger(ledger);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
