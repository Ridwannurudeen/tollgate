import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLicensePurchaseStore,
  type StoredLicenseSettlement,
} from "./license-purchase";

const paymentId = `0x${"1".repeat(64)}` as const;
const snapshotHash = `0x${"2".repeat(64)}` as const;
const settlement: StoredLicenseSettlement = {
  mode: "x402-settled",
  payer: "0x3333333333333333333333333333333333333333",
  transaction: `0x${"4".repeat(64)}`,
  responseHeader: "settled-response",
};

const tempDirs: string[] = [];

async function storePath(): Promise<string> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "aperture-license-purchase-"),
  );
  tempDirs.push(directory);
  return path.join(directory, "purchases.db");
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("license purchase journal", () => {
  it("atomically reserves a payment identity across independent instances", async () => {
    const filePath = await storePath();
    const first = createLicensePurchaseStore(filePath);
    const second = createLicensePurchaseStore(filePath);

    const [left, right] = await Promise.all([
      first.reserve(paymentId, snapshotHash),
      second.reserve(paymentId, snapshotHash),
    ]);

    expect([left.created, right.created].sort()).toEqual([false, true]);
    expect(left.purchase).toMatchObject({ paymentId, snapshotHash });
    expect(right.purchase).toMatchObject({ paymentId, snapshotHash });
  });

  it("persists the settled evidence and receipt transition across reopen", async () => {
    const filePath = await storePath();
    const first = createLicensePurchaseStore(filePath);
    await first.reserve(paymentId, snapshotHash);
    await first.markSettled(
      paymentId,
      snapshotHash,
      settlement,
      123_456,
    );

    const second = createLicensePurchaseStore(filePath);
    const resumed = await second.reserve(paymentId, snapshotHash);
    expect(resumed).toEqual({
      created: false,
      purchase: {
        paymentId,
        snapshotHash,
        state: "settled",
        settlement,
        authorizationExpiresAt: 123_456,
      },
    });

    await second.markReceipted(paymentId, snapshotHash);
    const completed = await first.reserve(paymentId, snapshotHash);
    expect(completed.purchase.state).toBe("receipted");
  });

  it("releases only an unsettled reservation", async () => {
    const filePath = await storePath();
    const store = createLicensePurchaseStore(filePath);

    await store.reserve(paymentId, snapshotHash);
    await store.release(paymentId, snapshotHash);
    expect((await store.reserve(paymentId, snapshotHash)).created).toBe(true);

    await store.markSettled(
      paymentId,
      snapshotHash,
      settlement,
      123_456,
    );
    await store.release(paymentId, snapshotHash);
    expect((await store.reserve(paymentId, snapshotHash)).purchase.state).toBe(
      "settled",
    );
  });
});
