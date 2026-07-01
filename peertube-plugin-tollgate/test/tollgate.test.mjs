import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { appendReceipt, readReceipts, verifyChain } = require("../lib/receipts.js");
const { parseWalletMap } = require("../lib/wallets.js");

function memStorage() {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    set: async (key, value) => {
      map.set(key, value);
    },
    del: async (key) => {
      map.delete(key);
    },
  };
}

function receiptInput(overrides) {
  return {
    eventId: "video:v1",
    videoId: "v1",
    videoName: "Demo",
    creatorWallet: "0x1111111111111111111111111111111111111111",
    amountAtomicUsdc: 2500,
    settlementMode: "forum-routed",
    transaction: "0xabc",
    feeRouterSplitId: "1",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

test("appendReceipt builds a valid hash chain", async () => {
  const storage = memStorage();
  await appendReceipt(storage, receiptInput({ eventId: "video:v1", videoId: "v1" }));
  await appendReceipt(storage, receiptInput({ eventId: "video:v2", videoId: "v2" }));
  const receipts = await readReceipts(storage);
  assert.equal(receipts.length, 2);
  assert.equal(receipts[1].previousHash, receipts[0].receiptHash);
  assert.equal(verifyChain(receipts).ok, true);
});

test("appendReceipt is idempotent per eventId", async () => {
  const storage = memStorage();
  const first = await appendReceipt(storage, receiptInput());
  const second = await appendReceipt(storage, receiptInput());
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.receipt.receiptHash, first.receipt.receiptHash);
  assert.equal((await readReceipts(storage)).length, 1);
});

test("verifyChain detects tampering", async () => {
  const storage = memStorage();
  await appendReceipt(storage, receiptInput({ eventId: "video:v1", videoId: "v1" }));
  await appendReceipt(storage, receiptInput({ eventId: "video:v2", videoId: "v2" }));
  const receipts = await readReceipts(storage);
  receipts[0].amountAtomicUsdc = 999999;
  const result = verifyChain(receipts);
  assert.equal(result.ok, false);
});

test("parseWalletMap parses valid entries and skips junk", () => {
  const raw = [
    "# comment",
    "",
    "v1=0x1111111111111111111111111111111111111111",
    "v2 = 0x2222222222222222222222222222222222222222",
    "bad=not-an-address",
    "noequals",
  ].join("\n");
  const map = parseWalletMap(raw);
  assert.equal(Object.keys(map).length, 2);
  assert.equal(map.v1, "0x1111111111111111111111111111111111111111");
  assert.equal(map.v2, "0x2222222222222222222222222222222222222222");
  assert.equal(map.bad, undefined);
});

test("parseWalletMap tolerates non-string input", () => {
  assert.deepEqual(parseWalletMap(undefined), {});
  assert.deepEqual(parseWalletMap(null), {});
});
