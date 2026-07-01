// Proof: drive the peertube-plugin-tollgate settlement path on-chain.
// Uses the plugin's own routeCreatorPayment (not a copy) + demo-payer operator
// wallet to route USDC to a creator via FeeRouterV1 on Arc, then builds the
// hash-chained receipt the plugin would store.
import { createRequire } from "node:module";
import { loadWallet } from "../citations/scripts/wallet-keystore.mjs";

const require = createRequire(import.meta.url);
const { routeCreatorPayment } = require("../peertube-plugin-tollgate/lib/fee-router.js");
const { appendReceipt, verifyChain } = require("../peertube-plugin-tollgate/lib/receipts.js");
const { DEFAULTS, explorerTxUrl } = require("../peertube-plugin-tollgate/lib/arc.js");

const RECIPIENT = "0xc9F2A6146cff81735925825b192ad6cdA4059c3c"; // creator-primary
const AMOUNT_ATOMIC = 2500; // 0.0025 USDC

function memStorage() {
  const map = new Map();
  return {
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v) => void map.set(k, v),
    del: async (k) => void map.delete(k),
  };
}

async function main() {
  const operator = await loadWallet("demo-payer");
  console.log(`operator (demo-payer): ${operator.address}`);
  console.log(`recipient (creator-primary): ${RECIPIENT}`);
  console.log(`amount: ${AMOUNT_ATOMIC} atomic USDC (0.0025 USDC)`);

  const storage = memStorage();
  const evidence = await routeCreatorPayment({
    recipient: RECIPIENT,
    amountAtomicUsdc: AMOUNT_ATOMIC,
    privateKey: operator.privateKey,
    chainId: DEFAULTS.chainId,
    rpcUrl: DEFAULTS.rpcUrl,
    usdc: DEFAULTS.usdc,
    feeRouter: DEFAULTS.feeRouter,
    storage,
  });

  console.log("\n=== on-chain settlement ===");
  console.log(`settlementMode: ${evidence.settlementMode}`);
  console.log(`feeRouter split: ${evidence.feeRouterSplitId}`);
  console.log(`createSplit tx: ${evidence.feeRouterCreateSplitTx}`);
  console.log(`pay tx:         ${evidence.transaction}`);
  console.log(`arcscan:        ${explorerTxUrl(DEFAULTS.explorerUrl, evidence.transaction)}`);

  const { receipt } = await appendReceipt(storage, {
    eventId: "video:proof-demo",
    videoId: "proof-demo",
    videoName: "PeerTube payout proof",
    creatorWallet: RECIPIENT,
    amountAtomicUsdc: AMOUNT_ATOMIC,
    settlementMode: evidence.settlementMode,
    transaction: evidence.transaction,
    feeRouterSplitId: evidence.feeRouterSplitId,
    createdAt: new Date().toISOString(),
  });

  const chain = verifyChain([receipt]);
  console.log("\n=== plugin receipt ===");
  console.log(`receiptHash: ${receipt.receiptHash}`);
  console.log(`chain valid: ${chain.ok}`);
}

main().catch((error) => {
  console.error("proof failed:", error);
  process.exitCode = 1;
});
