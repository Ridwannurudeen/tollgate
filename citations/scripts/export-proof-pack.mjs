import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ZERO_HASH = `0x${"0".repeat(64)}`;

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return `0x${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
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
  for (const key of ["payer", "transaction", "paymentResource"]) {
    if (includeUndefinedOptionals || receipt[key] !== undefined) {
      payload[key] = receipt[key];
    }
  }
  for (const key of [
    "feeRouterSplitId",
    "feeRouterCreateSplitTx",
    "feeRouterPayTx",
    "canonicalUrl",
    "sourceContentHash",
    "sourceExcerptHash",
    "contentFetchedAt",
    "ownershipProof",
  ]) {
    if (receipt[key] !== undefined) payload[key] = receipt[key];
  }
  return payload;
}

function verifyLedger(ledger) {
  const issues = [];
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
    const storedShapeHash = sha256Hex(receiptPayload(receipt, false));
    const legacyUndefinedHash = sha256Hex(receiptPayload(receipt, true));
    if (
      receipt.receiptHash !== storedShapeHash &&
      receipt.receiptHash !== legacyUndefinedHash
    ) {
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

  return {
    ok: issues.length === 0,
    queryCount: ledger.queries.length,
    receiptCount: ledger.receipts.length,
    latestHash: ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH,
    issues,
  };
}

const outputPath = process.argv[2] ?? path.join(appDir, "data", "proof-pack.json");
const ledger = await readJson(path.join(appDir, "data", "ledger.json"), {
  queries: [],
  receipts: [],
});
const customSources = await readJson(path.join(appDir, "data", "sources.json"), []);
const splitRegistry = await readJson(
  path.join(appDir, "data", "fee-router-splits.json"),
  { splits: [] },
);
const verification = verifyLedger(ledger);
const paidQueries = ledger.queries.filter((query) => query.readerPayment);
const uniquePayers = new Set(
  paidQueries
    .map((query) => query.readerPayment?.payer)
    .filter((payer) => Boolean(payer)),
);
const uniqueCreatorWallets = new Set(
  ledger.receipts.map((receipt) => receipt.wallet.toLowerCase()),
);
const sourceKinds = ledger.queries
  .flatMap((query) => query.citations ?? [])
  .concat(customSources)
  .map((source) => source.sourceKind ?? "seed");

const pack = {
  project: "tollgate-citations",
  generatedAt: new Date().toISOString(),
  traction: {
    externalSources: sourceKinds.filter((kind) => kind === "external").length,
    seedSources: sourceKinds.filter((kind) => kind === "seed").length,
    internalTestSources: sourceKinds.filter((kind) => kind === "internal-test")
      .length,
    paidQueries: paidQueries.length,
    payoutReceipts: ledger.receipts.length,
    uniquePayerWallets: uniquePayers.size,
    uniqueCreatorWallets: uniqueCreatorWallets.size,
    totalTestAtomicUsdc: ledger.receipts.reduce(
      (sum, receipt) => sum + receipt.amountAtomicUsdc,
      0,
    ),
  },
  ledger: {
    valid: verification.ok,
    verification,
    latestHash: verification.latestHash,
  },
  feeRouterSplits: splitRegistry,
  receipts: ledger.receipts,
  queries: ledger.queries,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, valid: verification.ok }, null, 2));
if (!verification.ok) process.exit(1);
