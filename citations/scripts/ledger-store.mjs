import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export function ledgerJsonPath(appDir) {
  return path.join(appDir, "data", "ledger.json");
}

export function ledgerDbPath(appDir) {
  return path.join(appDir, "data", "ledger.db");
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function openLedgerDatabase(dbPath) {
  const { DatabaseSync } = await import("node:sqlite").catch((error) => {
    throw new Error(
      `SQLite ledger requires Node with node:sqlite support: ${error.message}`,
    );
  });
  const db = new DatabaseSync(dbPath);
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

export async function readJsonLedger(appDir) {
  try {
    return JSON.parse(await readFile(ledgerJsonPath(appDir), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { queries: [], receipts: [] };
    throw error;
  }
}

export async function readSqliteLedger(appDir) {
  const db = await openLedgerDatabase(ledgerDbPath(appDir));
  try {
    const queries = db
      .prepare("SELECT payload_json FROM queries ORDER BY rowid DESC")
      .all()
      .map((row) => JSON.parse(row.payload_json));
    const receipts = db
      .prepare("SELECT payload_json FROM receipts ORDER BY rowid ASC")
      .all()
      .map((row) => JSON.parse(row.payload_json));
    return { queries, receipts };
  } finally {
    db.close();
  }
}

export async function readLedger(appDir) {
  return (await fileExists(ledgerDbPath(appDir)))
    ? readSqliteLedger(appDir)
    : readJsonLedger(appDir);
}

export async function hasSqliteLedger(appDir) {
  return fileExists(ledgerDbPath(appDir));
}

export async function updateSqliteQuery(appDir, query) {
  const db = await openLedgerDatabase(ledgerDbPath(appDir));
  try {
    db.prepare("UPDATE queries SET payload_json = ? WHERE id = ?").run(
      JSON.stringify(query),
      query.id,
    );
  } finally {
    db.close();
  }
}

export async function writeSqliteLedger(appDir, ledger) {
  await mkdir(path.dirname(ledgerDbPath(appDir)), { recursive: true });
  const db = await openLedgerDatabase(ledgerDbPath(appDir));
  try {
    db.exec("BEGIN IMMEDIATE");
    const insertQuery = db.prepare(
      "INSERT OR IGNORE INTO queries (id, created_at, payload_json) VALUES (?, ?, ?)",
    );
    const insertReaderPayment = db.prepare(
      "INSERT OR IGNORE INTO reader_payments (payment_hash, query_id, payload_json) VALUES (?, ?, ?)",
    );
    for (const query of ledger.queries.slice().reverse()) {
      insertQuery.run(query.id, query.createdAt, JSON.stringify(query));
      if (query.readerPayment) {
        insertReaderPayment.run(
          query.readerPayment.paymentHash,
          query.id,
          JSON.stringify(query.readerPayment),
        );
      }
    }
    const insertReceipt = db.prepare(
      "INSERT OR IGNORE INTO receipts (receipt_hash, query_id, previous_hash, created_at, payload_json) VALUES (?, ?, ?, ?, ?)",
    );
    for (const receipt of ledger.receipts) {
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
