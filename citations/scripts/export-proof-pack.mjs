import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLedger } from "./ledger-store.mjs";
import { verifyLedger } from "./verify-ledger.mjs";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const outputPath = process.argv[2] ?? path.join(appDir, "data", "proof-pack.json");
const ledger = await readLedger(appDir);
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
