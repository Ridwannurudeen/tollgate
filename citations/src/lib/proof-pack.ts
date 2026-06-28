import { readSources } from "./catalog";
import { readFeeRouterSplitRegistry } from "./fee-router";
import {
  readLedger,
  summarizeCreators,
  verifyLedgerIntegrity,
} from "./ledger";

export async function buildProofPack() {
  const [ledger, sources, splitRegistry] = await Promise.all([
    readLedger(),
    readSources(),
    readFeeRouterSplitRegistry(),
  ]);
  const creators = summarizeCreators(ledger);
  const paidQueries = ledger.queries.filter((query) => query.readerPayment);
  const uniquePayers = new Set(
    paidQueries
      .map((query) => query.readerPayment?.payer)
      .filter((payer): payer is string => Boolean(payer)),
  );
  const uniqueCreatorWallets = new Set(
    ledger.receipts.map((receipt) => receipt.wallet.toLowerCase()),
  );

  return {
    project: "tollgate-citations",
    generatedAt: new Date().toISOString(),
    traction: {
      externalSources: sources.filter((source) => source.sourceKind === "external")
        .length,
      seedSources: sources.filter((source) => source.sourceKind === "seed").length,
      internalTestSources: sources.filter(
        (source) => source.sourceKind === "internal-test",
      ).length,
      verifiedCreators: sources.filter((source) => source.verifiedCreator).length,
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
      valid: verifyLedgerIntegrity(ledger).ok,
      verification: verifyLedgerIntegrity(ledger),
      latestHash: ledger.receipts.at(-1)?.receiptHash ?? null,
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
}
