import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonPath = path.join(appDir, "data", "ledger.json");
const dbPath = path.join(appDir, "data", "ledger.db");

async function readJsonLedger() {
  try {
    return JSON.parse(await readFile(jsonPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { receipts: [] };
    throw error;
  }
}

function verifyChain(ledger) {
  const issues = [];
  let previousHash = ZERO_HASH;
  ledger.receipts.forEach((receipt, index) => {
    if (receipt.previousHash !== previousHash) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "previousHash does not match prior receipt",
      });
    }
    previousHash = receipt.receiptHash;
  });
  return {
    ok: issues.length === 0,
    receiptCount: ledger.receipts.length,
    latestHash: ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH,
    issues,
  };
}

async function openDatabase() {
  const { DatabaseSync } = await import("node:sqlite").catch((error) => {
    throw new Error(
      `SQLite ledger requires Node with node:sqlite support: ${error.message}`,
    );
  });
  await mkdir(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      receipt_hash TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
  `);
  return db;
}

function writeSqliteLedger(db, ledger) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const insertReceipt = db.prepare(
      "INSERT OR IGNORE INTO receipts (receipt_hash, event_id, previous_hash, created_at, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const receipt of ledger.receipts) {
      insertReceipt.run(
        receipt.receiptHash,
        receipt.eventId,
        receipt.previousHash,
        receipt.createdAt,
        JSON.stringify(receipt),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function readSqliteLedger(db) {
  const receipts = db
    .prepare("SELECT payload_json FROM receipts ORDER BY rowid ASC")
    .all()
    .map((row) => JSON.parse(row.payload_json));
  return { receipts };
}

const jsonLedger = await readJsonLedger();
const before = verifyChain(jsonLedger);
if (!before.ok) {
  console.error(JSON.stringify({ stage: "before", verification: before }, null, 2));
  process.exit(1);
}

const db = await openDatabase();
try {
  writeSqliteLedger(db, jsonLedger);
  const after = verifyChain(readSqliteLedger(db));
  console.log(
    JSON.stringify(
      {
        dbPath,
        before,
        after,
        idempotent: true,
      },
      null,
      2,
    ),
  );
  if (!after.ok) process.exit(1);
} finally {
  db.close();
}
