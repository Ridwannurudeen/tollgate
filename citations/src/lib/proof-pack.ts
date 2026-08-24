import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { publicSource, readSources } from "./catalog";
import { actorClassCounts, summarizeActorPayments } from "./actor-class";
import { feeRouterSplitRegistryStore } from "./fee-router";
import { readLedger, summarizeCreators, verifyLedgerIntegrity } from "./ledger";
import { tollgateAgentWallet } from "./payments";
import { payGateAddress } from "./pay-gate";
import { projectPublicData } from "./public-data";

const execFileAsync = promisify(execFile);
let fallbackDeployedCommit: Promise<string> | undefined;

async function readFallbackDeployedCommit(): Promise<string> {
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
    });
    return result.stdout.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function readDeployedCommit(): Promise<string> {
  const configured = process.env.LEPTONWEB_DEPLOY_COMMIT?.trim();
  if (configured) return Promise.resolve(configured);
  fallbackDeployedCommit ??= readFallbackDeployedCommit();
  return fallbackDeployedCommit;
}

export async function buildProofPack() {
  const [ledger, sources, splitRegistry, deployedCommit] = await Promise.all([
    readLedger(),
    readSources(),
    feeRouterSplitRegistryStore.read(),
    readDeployedCommit(),
  ]);
  const creators = summarizeCreators(ledger);
  const verification = verifyLedgerIntegrity(ledger);
  const paidQueries = ledger.queries.filter((query) => query.readerPayment);
  const paidPayments = paidQueries.flatMap((query) =>
    query.readerPayment ? [query.readerPayment] : [],
  );
  const actorMetrics = summarizeActorPayments(paidPayments);
  const uniqueCreatorWallets = new Set(
    ledger.receipts.map((receipt) => receipt.wallet.toLowerCase()),
  );
  const sourceDecisions = ledger.queries.flatMap(
    (query) => query.sourceDecisions ?? [],
  );
  const feeRouterPayouts = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "forum-routed",
  );
  const useIntentQueries = ledger.queries.filter((query) => query.useIntent);
  const payGateQueries = useIntentQueries.filter(
    (query) => query.useIntent?.payGate === true,
  );
  const configuredPayGateAddress = payGateAddress();
  const creatorClaimedSources = sources.filter(
    (source) => source.creatorClaimed === true,
  );

  return projectPublicData({
    project: "tollgate-citations",
    generatedAt: new Date().toISOString(),
    deployedCommit,
    agent: {
      strictLlmRuns: ledger.queries.filter(
        (query) =>
          query.agentMode === "llm" && query.agentServerMode === "judge-strict",
      ).length,
      llmRuns: ledger.queries.filter((query) => query.agentMode === "llm")
        .length,
      deterministicRuns: ledger.queries.filter(
        (query) => query.agentMode === "deterministic",
      ).length,
      buyDecisions: sourceDecisions.filter((decision) => decision.selected)
        .length,
      skipDecisions: sourceDecisions.filter((decision) => !decision.selected)
        .length,
      abstentions: ledger.queries.filter(
        (query) => query.citations.length === 0,
      ).length,
      refundedSources: ledger.queries.reduce(
        (sum, query) => sum + (query.refundSummary?.refundedCount ?? 0),
        0,
      ),
    },
    settlement: {
      readerPayments: {
        count: paidQueries.length,
        atomicUsdc: paidQueries.reduce(
          (sum, query) => sum + (query.readerPayment?.amountAtomicUsdc ?? 0),
          0,
        ),
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
      registryAddress:
        process.env.LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS ?? null,
      ...(configuredPayGateAddress || payGateQueries.length > 0
        ? {
            payGateAddress: configuredPayGateAddress,
            payGateSettledCount: payGateQueries.length,
          }
        : {}),
      agentWallet: tollgateAgentWallet(),
      anchoredCount: useIntentQueries.length,
      latestDigest: useIntentQueries.at(0)?.useIntent?.digest ?? null,
    },
    integrity: verification,
    traction: {
      externalSources: sources.filter(
        (source) => source.sourceKind === "external",
      ).length,
      seedSources: sources.filter((source) => source.sourceKind === "seed")
        .length,
      internalTestSources: sources.filter(
        (source) => source.sourceKind === "internal-test",
      ).length,
      verifiedCreators: sources.filter((source) => source.verifiedCreator)
        .length,
      paidQueries: actorMetrics.independent.paymentCount,
      independentPaidQueries: actorMetrics.independent.paymentCount,
      totalPaidQueries: actorMetrics.total.paymentCount,
      independentReaderPaymentsAtomicUsdc: actorMetrics.independent.atomicUsdc,
      totalReaderPaymentsAtomicUsdc: actorMetrics.total.atomicUsdc,
      actorClassCounts: actorClassCounts(paidPayments),
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
      latestHash: ledger.receipts.at(-1)?.receiptHash ?? null,
    },
    creators,
    sources: sources.map((source) => {
      const projected = publicSource(source);
      return {
        id: projected.id,
        title: projected.title,
        creator: projected.creator,
        wallet: projected.wallet,
        url: projected.url,
        sourceKind: projected.sourceKind,
        creatorKind: projected.creatorKind,
        verifiedCreator: projected.verifiedCreator,
        ownershipProof: projected.ownershipProof,
      };
    }),
    feeRouterSplits: splitRegistry,
    receipts: ledger.receipts,
    queries: ledger.queries,
  });
}

export type JudgeProofPack = Awaited<ReturnType<typeof buildProofPack>>;
