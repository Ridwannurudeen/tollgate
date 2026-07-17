import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { appendReceipt, readReceipts, verifyChain } = require("../lib/receipts.js");
const { parseWalletMap } = require("../lib/wallets.js");

test("pins the viem release containing the patched ws dependency", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const packageLock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  );

  assert.equal(packageJson.dependencies.viem, "2.55.2");
  assert.equal(packageLock.packages[""].dependencies.viem, "2.55.2");
  assert.equal(packageLock.packages["node_modules/viem"].version, "2.55.2");
  assert.equal(
    packageLock.packages["node_modules/viem"].dependencies.ws,
    "8.21.0",
  );
  assert.equal(packageLock.packages["node_modules/ws"].version, "8.21.0");
});

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

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function mockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function pluginHarness({
  getAuthUser,
  loadVideo = async (id) => ({ uuid: id, name: `Video ${id}` }),
  routeCreatorPayment,
  logger,
}) {
  const feeRouterPath = require.resolve("../lib/fee-router.js");
  const mainPath = require.resolve("../main.js");
  const feeRouter = require(feeRouterPath);
  const originalRouteCreatorPayment = feeRouter.routeCreatorPayment;
  feeRouter.routeCreatorPayment = routeCreatorPayment;
  delete require.cache[mainPath];
  const { register } = require(mainPath);
  feeRouter.routeCreatorPayment = originalRouteCreatorPayment;

  const storage = memStorage();
  const routes = new Map();
  const router = {
    get(path, handler) {
      routes.set(`GET ${path}`, handler);
    },
    post(path, handler) {
      routes.set(`POST ${path}`, handler);
    },
  };
  const settings = {
    "operator-private-key": "test-operator-key",
    "fee-router-address": "0x3333333333333333333333333333333333333333",
    "usdc-address": "0x4444444444444444444444444444444444444444",
    "arc-rpc-url": "http://127.0.0.1:8545",
    "arc-chain-id": "5042002",
    "explorer-url": "https://testnet.arcscan.app",
    "price-atomic-usdc": "2500",
    "gate-downloads": true,
    "default-creator-wallet": "0x1111111111111111111111111111111111111111",
    "creator-wallets": "",
  };

  await register({
    registerHook() {},
    registerSetting() {},
    settingsManager: {
      getSettings: async () => settings,
    },
    storageManager: {
      getData: storage.get,
      storeData: storage.set,
      deleteData: storage.del,
    },
    getRouter: () => router,
    peertubeHelpers: {
      logger:
        logger ??
        {
          warn() {},
          error() {},
      },
      user: { getAuthUser },
      videos: { loadByIdOrUUID: loadVideo },
    },
  });

  return routes.get("POST /video/:videoId/pay");
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

test("pay route rejects an anonymous request before settlement", async () => {
  let paymentCalls = 0;
  const handler = await pluginHarness({
    getAuthUser: async () => undefined,
    routeCreatorPayment: async () => {
      paymentCalls += 1;
      return {
        settlementMode: "forum-routed",
        transaction: "0xabc",
        feeRouterSplitId: "1",
      };
    },
  });
  const response = mockResponse();

  await handler(
    { params: { videoId: "v1" }, body: { videoName: "Demo" } },
    response,
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.body, { error: "authentication required" });
  assert.equal(paymentCalls, 0);
});

test("pay route rejects a nonexistent video before settlement", async () => {
  let paymentCalls = 0;
  const handler = await pluginHarness({
    getAuthUser: async () => ({ id: 1, username: "viewer" }),
    loadVideo: async () => null,
    routeCreatorPayment: async () => {
      paymentCalls += 1;
      return {
        settlementMode: "forum-routed",
        transaction: "0xabc",
        feeRouterSplitId: "1",
      };
    },
  });
  const response = mockResponse();

  await handler(
    { params: { videoId: "invented-video" }, body: {} },
    response,
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: "video not found" });
  assert.equal(paymentCalls, 0);
});

test("pay route caps one authenticated user's daily payouts", async () => {
  let paymentCalls = 0;
  const handler = await pluginHarness({
    getAuthUser: async () => ({ id: 7, username: "viewer" }),
    routeCreatorPayment: async () => {
      paymentCalls += 1;
      return {
        settlementMode: "forum-routed",
        transaction: `0x${paymentCalls.toString(16).padStart(64, "0")}`,
        feeRouterSplitId: "1",
      };
    },
  });

  for (let index = 0; index < 10; index += 1) {
    const response = mockResponse();
    await handler(
      { params: { videoId: `video-${index}` }, body: {} },
      response,
    );
    assert.equal(response.statusCode, 200);
  }

  const limited = mockResponse();
  await handler(
    { params: { videoId: "video-over-limit" }, body: {} },
    limited,
  );

  assert.equal(limited.statusCode, 429);
  assert.deepEqual(limited.body, { error: "daily payout limit reached" });
  assert.equal(paymentCalls, 10);
});

test("concurrent authenticated duplicate payments transfer once", async () => {
  const firstPaymentStarted = deferred();
  const releasePayment = deferred();
  let paymentCalls = 0;
  const handler = await pluginHarness({
    getAuthUser: async () => ({ id: 1, username: "viewer" }),
    routeCreatorPayment: async () => {
      paymentCalls += 1;
      if (paymentCalls === 1) firstPaymentStarted.resolve();
      await releasePayment.promise;
      return {
        settlementMode: "forum-routed",
        transaction: "0xabc",
        feeRouterSplitId: "1",
      };
    },
  });
  const firstResponse = mockResponse();
  const secondResponse = mockResponse();

  const firstRequest = handler(
    { params: { videoId: "v1" }, body: { videoName: "Demo" } },
    firstResponse,
  );
  await firstPaymentStarted.promise;
  const secondRequest = handler(
    { params: { videoId: "v1" }, body: { videoName: "Demo" } },
    secondResponse,
  );
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const callsBeforeRelease = paymentCalls;
  releasePayment.resolve();
  await Promise.all([firstRequest, secondRequest]);

  assert.equal(callsBeforeRelease, 1);
  assert.equal(paymentCalls, 1);
  assert.equal(firstResponse.body.created, true);
  assert.equal(secondResponse.body.created, false);
});

test("pay route does not expose settlement error details", async () => {
  const handler = await pluginHarness({
    getAuthUser: async () => ({ id: 1, username: "viewer" }),
    routeCreatorPayment: async () => {
      throw new Error("rpc failure with operator-private-key-marker");
    },
  });
  const response = mockResponse();

  await handler(
    { params: { videoId: "v1" }, body: { videoName: "Demo" } },
    response,
  );

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { error: "payout failed" });
  assert.equal(
    JSON.stringify(response.body).includes("operator-private-key-marker"),
    false,
  );
});
