"use strict";

const { isAddress, getAddress } = require("viem");
const { DEFAULTS, explorerTxUrl, formatUsdc } = require("./lib/arc");
const { routeCreatorPayment } = require("./lib/fee-router");
const { readReceipts, appendReceipt, verifyChain } = require("./lib/receipts");
const { parseWalletMap } = require("./lib/wallets");

const SETTING = {
  operatorKey: "operator-private-key",
  feeRouter: "fee-router-address",
  usdc: "usdc-address",
  rpcUrl: "arc-rpc-url",
  chainId: "arc-chain-id",
  explorerUrl: "explorer-url",
  price: "price-atomic-usdc",
  gateDownloads: "gate-downloads",
  defaultWallet: "default-creator-wallet",
  walletMap: "creator-wallets",
};

async function register({
  registerHook,
  registerSetting,
  settingsManager,
  storageManager,
  getRouter,
  peertubeHelpers,
}) {
  const logger = peertubeHelpers.logger;

  registerSetting({
    name: SETTING.operatorKey,
    label: "Operator private key (funds payouts)",
    type: "input-password",
    private: true,
    descriptionHTML:
      "Private key of the operator wallet that routes USDC to creators. Leave empty to run in verify-only mode (no on-chain payout).",
  });
  registerSetting({
    name: SETTING.defaultWallet,
    label: "Default creator wallet",
    type: "input",
    private: false,
    descriptionHTML: "Fallback recipient when a video has no explicit mapping.",
  });
  registerSetting({
    name: SETTING.walletMap,
    label: "Creator wallet mapping",
    type: "input-textarea",
    private: false,
    descriptionHTML: "One <code>videoUuid=0xWallet</code> per line.",
  });
  registerSetting({
    name: SETTING.price,
    label: "Price per unlock (atomic USDC, 6 decimals)",
    type: "input",
    default: "2500",
    private: false,
  });
  registerSetting({
    name: SETTING.gateDownloads,
    label: "Gate downloads until paid",
    type: "input-checkbox",
    default: true,
    private: false,
  });
  registerSetting({
    name: SETTING.feeRouter,
    label: "FeeRouter contract address",
    type: "input",
    default: DEFAULTS.feeRouter,
    private: false,
  });
  registerSetting({
    name: SETTING.usdc,
    label: "USDC contract address",
    type: "input",
    default: DEFAULTS.usdc,
    private: false,
  });
  registerSetting({
    name: SETTING.rpcUrl,
    label: "Arc RPC URL",
    type: "input",
    default: DEFAULTS.rpcUrl,
    private: false,
  });
  registerSetting({
    name: SETTING.chainId,
    label: "Arc chain id",
    type: "input",
    default: String(DEFAULTS.chainId),
    private: false,
  });
  registerSetting({
    name: SETTING.explorerUrl,
    label: "Block explorer URL",
    type: "input",
    default: DEFAULTS.explorerUrl,
    private: false,
  });

  const storage = {
    get: (key) => storageManager.getData(key),
    set: (key, value) => storageManager.storeData(key, value),
    del: (key) => storageManager.deleteData(key),
  };

  async function readConfig() {
    const values = await settingsManager.getSettings(Object.values(SETTING));
    const price = parseInt(values[SETTING.price], 10);
    return {
      operatorKey: values[SETTING.operatorKey] || "",
      feeRouter: values[SETTING.feeRouter] || DEFAULTS.feeRouter,
      usdc: values[SETTING.usdc] || DEFAULTS.usdc,
      rpcUrl: values[SETTING.rpcUrl] || DEFAULTS.rpcUrl,
      chainId: parseInt(values[SETTING.chainId], 10) || DEFAULTS.chainId,
      explorerUrl: values[SETTING.explorerUrl] || DEFAULTS.explorerUrl,
      priceAtomicUsdc: Number.isInteger(price) && price > 0 ? price : 2500,
      gateDownloads: values[SETTING.gateDownloads] !== false,
      defaultWallet: values[SETTING.defaultWallet] || "",
      walletMap: parseWalletMap(values[SETTING.walletMap]),
    };
  }

  function resolveWallet(config, videoId) {
    const mapped = config.walletMap[videoId];
    if (mapped) return mapped;
    if (config.defaultWallet && isAddress(config.defaultWallet)) {
      return getAddress(config.defaultWallet);
    }
    return null;
  }

  async function receiptForVideo(videoId) {
    const receipts = await readReceipts(storage);
    return receipts.find((receipt) => receipt.videoId === videoId) || null;
  }

  // ---- hooks -------------------------------------------------------------

  registerHook({
    target: "action:api.video.viewed",
    handler: async (params) => {
      try {
        const video = (params && params.video) || {};
        const videoId = String(video.uuid || video.id || "");
        if (!videoId) return;
        const key = `tollgate:views:${videoId}`;
        const current = (await storage.get(key)) || 0;
        await storage.set(key, Number(current) + 1);
      } catch (error) {
        logger.warn("[tollgate] view hook failed", error);
      }
    },
  });

  registerHook({
    target: "filter:api.download.video.allowed.result",
    handler: async (result, params) => {
      try {
        const config = await readConfig();
        if (!config.gateDownloads) return result;
        const video = (params && (params.video || params.videoAll)) || {};
        const videoId = String(video.uuid || video.id || "");
        if (!videoId) return result;
        const paid = await receiptForVideo(videoId);
        if (paid) return result;
        return {
          allowed: false,
          errorMessage: `Payment required: pay the creator ${formatUsdc(
            config.priceAtomicUsdc,
          )} USDC to unlock this download.`,
        };
      } catch (error) {
        logger.warn("[tollgate] download gate failed", error);
        return result;
      }
    },
  });

  // ---- routes ------------------------------------------------------------

  const router = getRouter();

  router.get("/config", async (_req, res) => {
    const config = await readConfig();
    res.json({
      chainId: config.chainId,
      feeRouter: config.feeRouter,
      usdc: config.usdc,
      explorerUrl: config.explorerUrl,
      priceAtomicUsdc: config.priceAtomicUsdc,
      priceUsdc: formatUsdc(config.priceAtomicUsdc),
      gateDownloads: config.gateDownloads,
      payoutsEnabled: Boolean(config.operatorKey),
    });
  });

  router.get("/video/:videoId/status", async (req, res) => {
    const config = await readConfig();
    const videoId = String(req.params.videoId);
    const receipt = await receiptForVideo(videoId);
    const wallet = resolveWallet(config, videoId);
    res.json({
      videoId,
      creatorWallet: wallet,
      priceAtomicUsdc: config.priceAtomicUsdc,
      priceUsdc: formatUsdc(config.priceAtomicUsdc),
      paid: Boolean(receipt),
      receipt: receipt || null,
      explorerTxUrl:
        receipt && receipt.transaction
          ? explorerTxUrl(config.explorerUrl, receipt.transaction)
          : null,
    });
  });

  router.post("/video/:videoId/pay", async (req, res) => {
    try {
      const config = await readConfig();
      const videoId = String(req.params.videoId);
      const videoName =
        req.body && typeof req.body.videoName === "string"
          ? req.body.videoName
          : "";

      const eventId = `video:${videoId}`;
      const existing = await receiptForVideo(videoId);
      if (existing) {
        return res.json({
          receipt: existing,
          created: false,
          explorerTxUrl: existing.transaction
            ? explorerTxUrl(config.explorerUrl, existing.transaction)
            : null,
        });
      }

      const wallet = resolveWallet(config, videoId);
      if (!wallet) {
        return res
          .status(400)
          .json({ error: "no creator wallet configured for this video" });
      }
      if (!config.operatorKey) {
        return res
          .status(402)
          .json({ error: "payouts are not configured (no operator key)" });
      }

      const evidence = await routeCreatorPayment({
        recipient: wallet,
        amountAtomicUsdc: config.priceAtomicUsdc,
        privateKey: config.operatorKey.startsWith("0x")
          ? config.operatorKey
          : `0x${config.operatorKey}`,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        usdc: config.usdc,
        feeRouter: config.feeRouter,
        storage,
      });

      const { receipt } = await appendReceipt(storage, {
        eventId,
        videoId,
        videoName,
        creatorWallet: wallet,
        amountAtomicUsdc: config.priceAtomicUsdc,
        settlementMode: evidence.settlementMode,
        transaction: evidence.transaction,
        feeRouterSplitId: evidence.feeRouterSplitId,
        createdAt: new Date().toISOString(),
      });

      res.json({
        receipt,
        created: true,
        explorerTxUrl: explorerTxUrl(config.explorerUrl, receipt.transaction),
      });
    } catch (error) {
      logger.error("[tollgate] payout failed", error);
      res.status(500).json({ error: String(error && error.message) });
    }
  });

  router.get("/proof", async (_req, res) => {
    const config = await readConfig();
    const receipts = await readReceipts(storage);
    const chain = verifyChain(receipts);
    res.json({
      feeRouter: config.feeRouter,
      chainId: config.chainId,
      explorerUrl: config.explorerUrl,
      receiptCount: receipts.length,
      totalRoutedAtomicUsdc: receipts.reduce(
        (sum, receipt) => sum + Number(receipt.amountAtomicUsdc || 0),
        0,
      ),
      chainValid: chain.ok,
      receipts,
    });
  });
}

async function unregister() {}

module.exports = { register, unregister };
