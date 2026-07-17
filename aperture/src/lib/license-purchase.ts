import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Hex } from "viem";

const LICENSE_PURCHASE_DB_PATH = path.join(
  process.cwd(),
  "data",
  "license-purchases.db",
);

export type StoredLicenseSettlement = {
  mode: "x402-verified" | "x402-settled";
  payer?: string;
  transaction?: string;
  responseHeader: string;
};

export type LicensePurchase = {
  paymentId: Hex;
  snapshotHash: Hex;
  state: "reserved" | "settled" | "receipted";
  settlement?: StoredLicenseSettlement;
  authorizationExpiresAt?: number;
};

export type LicensePurchaseStore = {
  reserve: (
    paymentId: Hex,
    snapshotHash: Hex,
  ) => Promise<{ created: boolean; purchase: LicensePurchase }>;
  markSettled: (
    paymentId: Hex,
    snapshotHash: Hex,
    settlement: StoredLicenseSettlement,
    authorizationExpiresAt: number,
  ) => Promise<void>;
  markReceipted: (paymentId: Hex, snapshotHash: Hex) => Promise<void>;
  release: (paymentId: Hex, snapshotHash: Hex) => Promise<void>;
};

type PurchaseRow = {
  payment_id: string;
  snapshot_hash: string;
  state: string;
  settlement_json: string | null;
  authorization_expires_at: number | null;
};

function isHex(value: string): value is Hex {
  return /^0x[0-9a-f]{64}$/i.test(value);
}

function isStoredSettlement(value: unknown): value is StoredLicenseSettlement {
  if (!value || typeof value !== "object") return false;
  const settlement = value as Partial<StoredLicenseSettlement>;
  return (
    (settlement.mode === "x402-verified" ||
      settlement.mode === "x402-settled") &&
    (settlement.payer === undefined ||
      typeof settlement.payer === "string") &&
    (settlement.transaction === undefined ||
      typeof settlement.transaction === "string") &&
    typeof settlement.responseHeader === "string"
  );
}

function purchaseFromRow(row: PurchaseRow): LicensePurchase {
  if (
    !isHex(row.payment_id) ||
    !isHex(row.snapshot_hash) ||
    (row.state !== "reserved" &&
      row.state !== "settled" &&
      row.state !== "receipted")
  ) {
    throw new Error("License purchase journal contains an invalid row.");
  }

  let settlement: StoredLicenseSettlement | undefined;
  if (row.settlement_json !== null) {
    const parsed = JSON.parse(row.settlement_json) as unknown;
    if (!isStoredSettlement(parsed)) {
      throw new Error(
        "License purchase journal contains invalid settlement evidence.",
      );
    }
    settlement = parsed;
  }

  if (
    row.authorization_expires_at !== null &&
    !Number.isSafeInteger(row.authorization_expires_at)
  ) {
    throw new Error(
      "License purchase journal contains an invalid authorization expiry.",
    );
  }

  return {
    paymentId: row.payment_id,
    snapshotHash: row.snapshot_hash,
    state: row.state,
    ...(settlement ? { settlement } : {}),
    ...(row.authorization_expires_at !== null
      ? { authorizationExpiresAt: row.authorization_expires_at }
      : {}),
  };
}

async function openDatabase(filePath: string): Promise<DatabaseSync> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const sqlite = await import("node:sqlite").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(
      `License purchase journal requires node:sqlite support: ${message}`,
    );
  });
  const database = new sqlite.DatabaseSync(filePath, { timeout: 5_000 });
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS license_purchases (
      payment_id TEXT PRIMARY KEY,
      snapshot_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('reserved', 'settled', 'receipted')),
      settlement_json TEXT,
      authorization_expires_at INTEGER
    ) STRICT;
  `);
  return database;
}

function readPurchase(
  database: DatabaseSync,
  paymentId: Hex,
): LicensePurchase | null {
  const row = database
    .prepare(
      "SELECT payment_id, snapshot_hash, state, settlement_json, authorization_expires_at FROM license_purchases WHERE payment_id = ?",
    )
    .get(paymentId) as PurchaseRow | undefined;
  return row ? purchaseFromRow(row) : null;
}

async function withImmediateTransaction<T>(
  filePath: string,
  work: (database: DatabaseSync) => T,
): Promise<T> {
  const database = await openDatabase(filePath);
  let transactionOpen = false;
  try {
    database.exec("BEGIN IMMEDIATE");
    transactionOpen = true;
    const result = work(database);
    database.exec("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

function assertSnapshot(
  purchase: LicensePurchase,
  snapshotHash: Hex,
): void {
  if (purchase.snapshotHash !== snapshotHash) {
    throw new Error(
      "Payment identity is already bound to a different license snapshot.",
    );
  }
}

export function createLicensePurchaseStore(
  filePath: string = LICENSE_PURCHASE_DB_PATH,
): LicensePurchaseStore {
  return {
    reserve: (paymentId, snapshotHash) =>
      withImmediateTransaction(filePath, (database) => {
        const existing = readPurchase(database, paymentId);
        if (existing) {
          assertSnapshot(existing, snapshotHash);
          return { created: false, purchase: existing };
        }

        database
          .prepare(
            "INSERT INTO license_purchases (payment_id, snapshot_hash, state) VALUES (?, ?, 'reserved')",
          )
          .run(paymentId, snapshotHash);
        return {
          created: true,
          purchase: {
            paymentId,
            snapshotHash,
            state: "reserved" as const,
          },
        };
      }),
    markSettled: (
      paymentId,
      snapshotHash,
      settlement,
      authorizationExpiresAt,
    ) =>
      withImmediateTransaction(filePath, (database) => {
        const purchase = readPurchase(database, paymentId);
        if (!purchase) {
          throw new Error("License purchase reservation is missing.");
        }
        assertSnapshot(purchase, snapshotHash);
        if (purchase.state !== "reserved") return;
        database
          .prepare(
            "UPDATE license_purchases SET state = 'settled', settlement_json = ?, authorization_expires_at = ? WHERE payment_id = ? AND state = 'reserved'",
          )
          .run(
            JSON.stringify(settlement),
            authorizationExpiresAt,
            paymentId,
          );
      }),
    markReceipted: (paymentId, snapshotHash) =>
      withImmediateTransaction(filePath, (database) => {
        const purchase = readPurchase(database, paymentId);
        if (!purchase) {
          throw new Error("License purchase reservation is missing.");
        }
        assertSnapshot(purchase, snapshotHash);
        if (purchase.state === "receipted") return;
        if (purchase.state !== "settled") {
          throw new Error("License purchase has not settled.");
        }
        database
          .prepare(
            "UPDATE license_purchases SET state = 'receipted' WHERE payment_id = ? AND state = 'settled'",
          )
          .run(paymentId);
      }),
    release: (paymentId, snapshotHash) =>
      withImmediateTransaction(filePath, (database) => {
        const purchase = readPurchase(database, paymentId);
        if (!purchase) return;
        assertSnapshot(purchase, snapshotHash);
        database
          .prepare(
            "DELETE FROM license_purchases WHERE payment_id = ? AND state = 'reserved'",
          )
          .run(paymentId);
      }),
  };
}
