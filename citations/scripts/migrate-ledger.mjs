import { fileURLToPath } from "node:url";
import {
  ledgerDbPath,
  readJsonLedger,
  readSqliteLedger,
  writeSqliteLedger,
} from "./ledger-store.mjs";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const appDir = fileURLToPath(new URL("..", import.meta.url));

function verifyChain(ledger) {
  const issues = [];
  const queryIds = new Set(ledger.queries.map((query) => query.id));
  let previousHash = ZERO_HASH;
  ledger.receipts.forEach((receipt, index) => {
    if (receipt.previousHash !== previousHash) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "previousHash does not match prior receipt",
      });
    }
    if (!queryIds.has(receipt.queryId)) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "receipt references missing query",
      });
    }
    previousHash = receipt.receiptHash;
  });
  return {
    ok: issues.length === 0,
    queryCount: ledger.queries.length,
    receiptCount: ledger.receipts.length,
    latestHash: ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH,
    issues,
  };
}

const jsonLedger = await readJsonLedger(appDir);
const before = verifyChain(jsonLedger);
if (!before.ok) {
  console.error(JSON.stringify({ stage: "before", verification: before }, null, 2));
  process.exit(1);
}

await writeSqliteLedger(appDir, jsonLedger);
const sqliteLedger = await readSqliteLedger(appDir);
const after = verifyChain(sqliteLedger);

console.log(
  JSON.stringify(
    {
      dbPath: ledgerDbPath(appDir),
      before,
      after,
      idempotent: true,
    },
    null,
    2,
  ),
);
if (!after.ok) process.exit(1);
