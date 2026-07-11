import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readLedger } from "./ledger-store.mjs";
import { verifyLedger } from "./verify-ledger.mjs";

const appDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const execFileAsync = promisify(execFile);

const ACTOR_CLASSES = ["operator", "fixture", "volume-engine", "reciprocal-partner", "sponsored-cold-human", "self-funded-cold-human", "external-agent", "external-integrator", "unclassified"];
const DEFAULT_AGENT_WALLET = "0x5C94b3aBb29c1dFcA24313B9A2D383960Cd69836";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

function normalizeAddress(value) {
  return typeof value === "string" ? value.toLowerCase() : null;
}

function isAddress(value) {
  return typeof value === "string" && ADDRESS_PATTERN.test(value);
}

function isIndependentActorClass(actorClass) {
  return (
    actorClass !== "operator" &&
    actorClass !== "fixture" &&
    actorClass !== "volume-engine" &&
    actorClass !== "reciprocal-partner" &&
    actorClass !== "unclassified"
  );
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function readActorClassMap(raw) {
  const wallets = raw && typeof raw === "object" ? raw.wallets : {};
  if (!wallets || typeof wallets !== "object") return {};
  return Object.fromEntries(
    Object.entries(wallets)
      .filter(
        ([wallet, actorClass]) =>
          isAddress(wallet) && ACTOR_CLASSES.includes(actorClass),
      )
      .map(([wallet, actorClass]) => [wallet.toLowerCase(), actorClass]),
  );
}

function actorClassForPayer(payer, walletClasses) {
  if (!isAddress(payer)) return "unclassified";
  const payerLower = normalizeAddress(payer);
  return walletClasses[payerLower] ?? "unclassified";
}

function actorClassForPayment(payment, actorClasses) {
  if (payment?.actorClass && ACTOR_CLASSES.includes(payment.actorClass)) {
    return payment.actorClass;
  }
  return actorClassForPayer(payment?.payer, actorClasses);
}

function actorPaymentMetrics(payments, actorClasses) {
  const byClass = Object.fromEntries(
    ACTOR_CLASSES.map((actorClass) => [
      actorClass,
      { paymentCount: 0, atomicUsdc: 0, uniquePayerWallets: 0 },
    ]),
  );
  const walletsByClass = new Map(
    ACTOR_CLASSES.map((actorClass) => [actorClass, new Set()]),
  );
  const independentWallets = new Set();
  const totalWallets = new Set();
  let independentPaymentCount = 0;
  let independentAtomicUsdc = 0;
  let totalAtomicUsdc = 0;
  for (const payment of payments) {
    const actorClass = actorClassForPayment(payment, actorClasses);
    const amountAtomicUsdc = payment.amountAtomicUsdc ?? 0;
    byClass[actorClass].paymentCount += 1;
    byClass[actorClass].atomicUsdc += amountAtomicUsdc;
    totalAtomicUsdc += amountAtomicUsdc;
    if (isAddress(payment.payer)) {
      const payer = normalizeAddress(payment.payer);
      walletsByClass.get(actorClass).add(payer);
      totalWallets.add(payer);
      if (isIndependentActorClass(actorClass)) independentWallets.add(payer);
    }
    if (isIndependentActorClass(actorClass)) {
      independentPaymentCount += 1;
      independentAtomicUsdc += amountAtomicUsdc;
    }
  }
  for (const actorClass of ACTOR_CLASSES) {
    byClass[actorClass].uniquePayerWallets = walletsByClass.get(actorClass).size;
  }
  return {
    byClass,
    independent: {
      paymentCount: independentPaymentCount,
      atomicUsdc: independentAtomicUsdc,
      uniquePayerWallets: independentWallets.size,
    },
    total: {
      paymentCount: payments.length,
      atomicUsdc: totalAtomicUsdc,
      uniquePayerWallets: totalWallets.size,
    },
    unclassified: { ...byClass.unclassified },
  };
}

function preferredSourceKind(current, next) {
  if (next === "external" || current === undefined) return next ?? current;
  if (current === "external") return current;
  return current;
}

function preferredCreatorKind(current, next) {
  if (next === "external" || current === undefined) return next ?? current;
  if (current === "external") return current;
  return current;
}

function isCreatorEarnedReceipt(receipt) {
  return receipt.settlementMode !== "escrowed" && receipt.settlementMode !== "refunded";
}

function summarizeCreators(ledger, queryById) {
  const byWallet = new Map();
  const sourceIdsByWallet = new Map();
  for (const receipt of ledger.receipts) {
    if (!isCreatorEarnedReceipt(receipt)) continue;
    const query = queryById.get(receipt.queryId);
    const citation = query?.citations.find(
      (candidate) => candidate.sourceId === receipt.sourceId,
    );
    const current = byWallet.get(receipt.wallet) ?? {
      creator: receipt.creator,
      handle: citation?.handle ?? "@unknown",
      wallet: receipt.wallet,
      sourceCount: 0,
      citationCount: 0,
      earnedAtomicUsdc: 0,
      sourceKind: citation?.sourceKind,
      creatorKind: citation?.creatorKind,
      verifiedCreator: citation?.verifiedCreator,
      creatorClaimed: citation?.creatorClaimed,
    };
    current.sourceKind = preferredSourceKind(
      current.sourceKind,
      citation?.sourceKind,
    );
    current.creatorKind = preferredCreatorKind(
      current.creatorKind,
      citation?.creatorKind,
    );
    current.verifiedCreator =
      current.verifiedCreator === true || citation?.verifiedCreator === true;
    current.creatorClaimed =
      current.creatorClaimed === true || citation?.creatorClaimed === true;
    current.citationCount += 1;
    current.earnedAtomicUsdc += receipt.amountAtomicUsdc;
    byWallet.set(receipt.wallet, current);

    const sourceIds = sourceIdsByWallet.get(receipt.wallet) ?? new Set();
    sourceIds.add(receipt.sourceId);
    sourceIdsByWallet.set(receipt.wallet, sourceIds);
  }
  return Array.from(byWallet.values())
    .map((creator) => ({
      ...creator,
      sourceCount: sourceIdsByWallet.get(creator.wallet)?.size ?? 0,
    }))
    .sort((a, b) => b.earnedAtomicUsdc - a.earnedAtomicUsdc);
}

async function readDeployedCommit() {
  const configured = process.env.LEPTONWEB_DEPLOY_COMMIT?.trim();
  if (configured) return configured;
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: appDir,
    });
    return result.stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function tollgateAgentWallet() {
  const wallet = process.env.LEPTONWEB_AGENT_WALLET ?? DEFAULT_AGENT_WALLET;
  if (!isAddress(wallet)) {
    throw new Error("LEPTONWEB_AGENT_WALLET must be a 20-byte EVM address.");
  }
  return wallet;
}

async function main() {
  const outputPath =
    process.argv[2] ?? path.join(appDir, "data", "proof-pack.json");
  const [ledger, actorClassData, sources, splitRegistry, deployedCommit] =
    await Promise.all([
      readLedger(appDir),
      readJson(path.join(appDir, "data", "actor-classes.json"), {
        wallets: {},
      }),
      readJson(path.join(appDir, "data", "sources.json"), []),
      readJson(path.join(appDir, "data", "fee-router-splits.json"), {
        splits: [],
      }),
      readDeployedCommit(),
    ]);
  const actorClassMap = readActorClassMap(actorClassData);
  const verification = verifyLedger(ledger);
  const paidQueries = ledger.queries.filter((query) => query.readerPayment);
  const paidPayments = paidQueries.flatMap((query) =>
    query.readerPayment ? [query.readerPayment] : [],
  );
  const actorMetrics = actorPaymentMetrics(paidPayments, actorClassMap);
  const uniqueCreatorWallets = new Set(
    ledger.receipts.map((receipt) => receipt.wallet.toLowerCase()),
  );
  const sourceDecisions = ledger.queries.flatMap(
    (query) => query.sourceDecisions ?? [],
  );
  const useIntentQueries = ledger.queries.filter((query) => query.useIntent);
  const feeRouterPayouts = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "forum-routed",
  );
  const queryById = new Map(ledger.queries.map((query) => [query.id, query]));
  const creators = summarizeCreators(ledger, queryById);
  const creatorClaimedSources = sources.filter(
    (source) => source.creatorClaimed === true,
  );
  const totalReaderPayments = paidPayments.reduce(
    (sum, payment) => sum + payment.amountAtomicUsdc,
    0,
  );
  const totalReaderPaymentsAtomicUsdc = totalReaderPayments;

  const pack = {
    project: "tollgate-citations",
    generatedAt: new Date().toISOString(),
    deployedCommit,
    agent: {
      strictLlmRuns: ledger.queries.filter(
        (query) =>
          query.agentMode === "llm" && query.agentServerMode === "judge-strict",
      ).length,
      llmRuns: ledger.queries.filter((query) => query.agentMode === "llm").length,
      deterministicRuns: ledger.queries.filter(
        (query) => query.agentMode === "deterministic",
      ).length,
      buyDecisions: sourceDecisions.filter((decision) => decision.selected).length,
      skipDecisions: sourceDecisions.filter(
        (decision) => !decision.selected,
      ).length,
      abstentions: ledger.queries.filter(
        (query) => (query.citations ?? []).length === 0,
      ).length,
      refundedSources: ledger.queries.reduce(
        (sum, query) => sum + (query.refundSummary?.refundedCount ?? 0),
        0,
      ),
    },
    settlement: {
      readerPayments: {
        count: paidQueries.length,
        atomicUsdc: totalReaderPaymentsAtomicUsdc,
      },
      feeRouterPayouts: {
        count: feeRouterPayouts.length,
        atomicUsdc: feeRouterPayouts.reduce(
          (sum, receipt) => sum + receipt.amountAtomicUsdc,
          0,
        ),
      },
      creatorClaims: {
        count: creatorClaimedSources.length,
        wallets: creatorClaimedSources.map((source) => source.wallet),
      },
    },
    useIntent: {
      enabled: process.env.LEPTONWEB_USE_INTENT_ENABLED === "1",
      registryAddress: process.env.LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS ?? null,
      agentWallet: tollgateAgentWallet(),
      anchoredCount: useIntentQueries.length,
      latestDigest: useIntentQueries.at(0)?.useIntent?.digest ?? null,
    },
    integrity: verification,
    traction: {
      externalSources: sources.filter(
        (source) => source.sourceKind === "external",
      ).length,
      seedSources: sources.filter((source) => source.sourceKind === "seed").length,
      internalTestSources: sources.filter(
        (source) => source.sourceKind === "internal-test",
      ).length,
      verifiedCreators: sources.filter((source) => source.verifiedCreator).length,
      paidQueries: actorMetrics.independent.paymentCount,
      independentPaidQueries: actorMetrics.independent.paymentCount,
      totalPaidQueries: actorMetrics.total.paymentCount,
      independentReaderPaymentsAtomicUsdc: actorMetrics.independent.atomicUsdc,
      totalReaderPaymentsAtomicUsdc: actorMetrics.total.atomicUsdc,
      actorClassCounts: Object.fromEntries(
        ACTOR_CLASSES.map((actorClass) => [
          actorClass,
          actorMetrics.byClass[actorClass].paymentCount,
        ]),
      ),
      actorMetrics,
      payoutReceipts: ledger.receipts.length,
      uniquePayerWallets: actorMetrics.independent.uniquePayerWallets,
      totalUniquePayerWallets: actorMetrics.total.uniquePayerWallets,
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
    creators,
    sources: sources.map((source) => ({
      id: source.id,
      title: source.title,
      creator: source.creator,
      wallet: source.wallet,
      url: source.url,
      sourceKind: source.sourceKind,
      creatorKind: source.creatorKind,
      verifiedCreator: source.verifiedCreator,
      ownershipProof: source.ownershipProof,
    })),
    feeRouterSplits: splitRegistry,
    receipts: ledger.receipts,
    queries: ledger.queries,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, valid: verification.ok }, null, 2));
  if (!verification.ok) process.exit(1);
}

main().catch((error) => {
  console.error(
    `Failed to export proof pack: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
