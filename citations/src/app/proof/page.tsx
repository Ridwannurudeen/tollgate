import Link from "next/link";
import { readSources } from "@/lib/catalog";
import { readCovenantEnvelope } from "@/lib/covenant";
import {
  formatBudgetUtilization,
  ledgerPaidQueryEconomics,
} from "@/lib/economics";
import {
  arcscanTxUrl,
  formatAtomicUsdc,
  formatDollars,
  formatUsdc,
  settlementLabel,
  shortHash,
  shortWallet,
} from "@/lib/format";
import {
  readLedger,
  summarizeCreators,
  verifyLedgerIntegrity,
} from "@/lib/ledger";
import { readSlashBondStatus } from "@/lib/slash-bond";
import type { Ledger } from "@/lib/types";

export const dynamic = "force-dynamic";

type SourceStat = {
  sourceId: string;
  title: string;
  creator: string;
  earnedAtomicUsdc: number;
  citationCount: number;
};

function totalReceiptPaid(ledger: Ledger): number {
  return ledger.receipts.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );
}

function sourceStats(ledger: Ledger): SourceStat[] {
  const stats = new Map<string, SourceStat>();

  for (const query of ledger.queries) {
    for (const citation of query.citations) {
      const current = stats.get(citation.sourceId) ?? {
        sourceId: citation.sourceId,
        title: citation.title,
        creator: citation.creator,
        earnedAtomicUsdc: 0,
        citationCount: 0,
      };
      current.earnedAtomicUsdc += citation.amountAtomicUsdc;
      current.citationCount += 1;
      stats.set(citation.sourceId, current);
    }
  }

  return Array.from(stats.values()).sort(
    (a, b) => b.earnedAtomicUsdc - a.earnedAtomicUsdc,
  );
}

export default async function ProofPage() {
  const [ledger, sources, covenant, slashBond] = await Promise.all([
    readLedger(),
    readSources(),
    readCovenantEnvelope().catch(() => null),
    readSlashBondStatus().catch(() => null),
  ]);
  const creators = summarizeCreators(ledger);
  const verification = verifyLedgerIntegrity(ledger);
  const sourceLeaders = sourceStats(ledger);
  const latestReceipt = ledger.receipts.at(-1);
  const latestQuery = ledger.queries[0] ?? null;
  const economics = ledgerPaidQueryEconomics(ledger);
  const externalSources = sources.filter(
    (source) => source.sourceKind === "external",
  );
  const seedSources = sources.filter((source) => source.sourceKind === "seed");
  const internalSources = sources.filter(
    (source) => source.sourceKind === "internal-test",
  );
  const paidQueries = ledger.queries.filter((query) => query.readerPayment);
  const uniquePayers = new Set(
    paidQueries
      .map((query) => query.readerPayment?.payer)
      .filter((payer): payer is string => Boolean(payer)),
  );
  const uniqueCreatorWallets = new Set(
    ledger.receipts.map((receipt) => receipt.wallet.toLowerCase()),
  );
  const verifiedReceiptCount = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "x402-verified",
  ).length;
  const settledReceiptCount = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "x402-settled",
  ).length;
  const forumRoutedReceiptCount = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "forum-routed",
  ).length;
  const trackRecordQueries = ledger.queries.filter(
    (query) => query.trackRecord,
  );
  const latestTrackRecord = trackRecordQueries[0]?.trackRecord;

  return (
    <main className="shell receipt-page">
      <header className="receipt-header">
        <div>
          <p className="eyebrow">network proof</p>
          <h1>Tollgate payout ledger</h1>
        </div>
        <Link className="wallet-button receipt-back" href="/">
          Back to Tollgate
        </Link>
      </header>

      <section className="receipt-proof">
        <div className="signature-stat proof-stat">
          <span className="stat-label">creator payouts recorded</span>
          <strong>{formatDollars(totalReceiptPaid(ledger))}</strong>
          <div className="receipt-lines">
            <span className="receipt-line">
              receipts <strong>{ledger.receipts.length}</strong>
            </span>
            <span className="receipt-line">
              chain <strong>{verification.ok ? "valid" : "review"}</strong>
            </span>
          </div>
          <span className="stamp" aria-hidden="true">
            {verification.ok ? "verified" : "review"}
          </span>
        </div>
        <div className="proof-copy">
          <p className="eyebrow">
            ledger {verification.ok ? "verified" : "needs review"}
          </p>
          <h2>{ledger.receipts.length} receipts</h2>
          <p className="hero-text">
            This page aggregates the public proof surface judges need: receipt
            chain health, creator payout totals, reader-paid queries, source
            inventory, and links into every underlying receipt.
          </p>
        </div>
      </section>

      <section className="metrics-band profile-metrics">
        <div className="metric">
          <span>answers</span>
          <strong>{ledger.queries.length}</strong>
        </div>
        <div className="metric">
          <span>creators paid</span>
          <strong>{creators.length}</strong>
        </div>
        <div className="metric">
          <span>priced sources</span>
          <strong>{sources.length}</strong>
        </div>
        <div className="metric">
          <span>reader paid</span>
          <strong>{formatDollars(economics.readerPaidAtomicUsdc)}</strong>
        </div>
        <div className="metric">
          <span>creator payouts</span>
          <strong>{formatDollars(economics.creatorPayoutsAtomicUsdc)}</strong>
        </div>
        <div className="metric">
          <span>protocol retained</span>
          <strong>{formatDollars(economics.protocolRetainedAtomicUsdc)}</strong>
        </div>
        <div className="metric">
          <span>budget utilization</span>
          <strong>{formatBudgetUtilization(economics)}</strong>
        </div>
        <div className="metric">
          <span>track records</span>
          <strong>{trackRecordQueries.length}</strong>
        </div>
        <div className="metric">
          <span>covenant vaults</span>
          <strong>{covenant?.botVaults.length ?? 0}</strong>
        </div>
        <div className="metric">
          <span>bond at stake</span>
          <strong>
            {slashBond ? formatDollars(slashBond.bondBalance.toString()) : "$0"}
          </strong>
        </div>
        <div className="metric wide">
          <span>latest hash</span>
          <strong>
            {latestReceipt ? shortHash(latestReceipt.receiptHash) : "none"}
          </strong>
        </div>
      </section>

      <section className="evidence-grid">
        <div className="evidence-row">
          <span>receipt chain</span>
          <strong>{verification.ok ? "valid" : "invalid"}</strong>
        </div>
        <div className="evidence-row">
          <span>verification issues</span>
          <strong>{verification.issues.length}</strong>
        </div>
        <div className="evidence-row">
          <span>x402 verified receipts</span>
          <strong>{verifiedReceiptCount}</strong>
        </div>
        <div className="evidence-row">
          <span>x402 settled receipts</span>
          <strong>{settledReceiptCount}</strong>
        </div>
        <div className="evidence-row">
          <span>Forum routed receipts</span>
          <strong>{forumRoutedReceiptCount}</strong>
        </div>
        <div className="evidence-row">
          <span>latest TrackRecord</span>
          <strong>
            {latestTrackRecord
              ? shortHash(latestTrackRecord.recordHash)
              : "none"}
          </strong>
        </div>
        <div className="evidence-row">
          <span>covenant budget</span>
          <strong>
            {covenant?.latestVault
              ? `${formatAtomicUsdc(
                  covenant.latestVault.mandate.budgetUsdc,
                )} USDC`
              : "none"}
          </strong>
        </div>
        <div className="evidence-row">
          <span>total slashed</span>
          <strong>
            {slashBond
              ? `${formatAtomicUsdc(slashBond.totalSlashed)} USDC`
              : "none"}
          </strong>
        </div>
        <div className="evidence-row">
          <span>latest previous hash</span>
          <strong title={latestReceipt?.previousHash ?? undefined}>
            {latestReceipt ? shortHash(latestReceipt.previousHash) : "none"}
          </strong>
        </div>
      </section>

      <section className="receipt-ledger">
        <div className="panel-heading">
          <p className="eyebrow">traction quality</p>
          <h3>Real, seed, and internal activity are separated</h3>
        </div>
        <div className="metrics-band profile-metrics">
          <div className="metric">
            <span>external sources</span>
            <strong>{externalSources.length}</strong>
          </div>
          <div className="metric">
            <span>seed/demo sources</span>
            <strong>{seedSources.length}</strong>
          </div>
          <div className="metric">
            <span>internal-test sources</span>
            <strong>{internalSources.length}</strong>
          </div>
          <div className="metric">
            <span>verified creators</span>
            <strong>
              {sources.filter((source) => source.verifiedCreator).length}
            </strong>
          </div>
          <div className="metric">
            <span>paid queries</span>
            <strong>{paidQueries.length}</strong>
          </div>
          <div className="metric">
            <span>payout receipts</span>
            <strong>{ledger.receipts.length}</strong>
          </div>
          <div className="metric">
            <span>unique payer wallets</span>
            <strong>{uniquePayers.size}</strong>
          </div>
          <div className="metric">
            <span>unique creator wallets</span>
            <strong>{uniqueCreatorWallets.size}</strong>
          </div>
          <div className="metric">
            <span>total test USDC</span>
            <strong>{formatDollars(totalReceiptPaid(ledger))}</strong>
          </div>
        </div>
      </section>

      {latestQuery?.agentBudget && (
        <section className="receipt-ledger">
          <div className="panel-heading">
            <p className="eyebrow">agent accountability</p>
            <h3>Latest answer budget envelope</h3>
          </div>
          <div className="evidence-grid">
            <div className="evidence-row">
              <span>budget envelope</span>
              <strong>
                {formatUsdc(latestQuery.agentBudget.sourceBudgetAtomicUsdc)}{" "}
                USDC
              </strong>
            </div>
            <div className="evidence-row">
              <span>spent on sources</span>
              <strong>
                {formatUsdc(latestQuery.agentBudget.spentAtomicUsdc)} USDC
              </strong>
            </div>
            <div className="evidence-row">
              <span>unused</span>
              <strong>
                {formatUsdc(latestQuery.agentBudget.remainingAtomicUsdc)} USDC
              </strong>
            </div>
            <div className="evidence-row">
              <span>source cap</span>
              <strong>
                {latestQuery.agentBudget.purchasedCount}/
                {latestQuery.agentBudget.candidateCount}
              </strong>
            </div>
            <div className="evidence-row">
              <span>TrackRecord anchor</span>
              <strong>
                {latestQuery.trackRecord
                  ? shortHash(latestQuery.trackRecord.recordHash)
                  : "none"}
              </strong>
            </div>
            <div className="evidence-row">
              <span>SlashBond status</span>
              <strong>
                {slashBond
                  ? `${formatAtomicUsdc(slashBond.bondBalance)} USDC bonded`
                  : "not published locally"}
              </strong>
            </div>
            <div className="evidence-row">
              <span>receipt chain hash</span>
              <strong>{latestReceipt?.receiptHash ?? "none"}</strong>
            </div>
          </div>
        </section>
      )}

      {trackRecordQueries.length > 0 && (
        <section className="receipt-ledger">
          <div className="panel-heading">
            <p className="eyebrow">Forum TrackRecordV2</p>
            <h3>On-chain answer anchors</h3>
          </div>
          {trackRecordQueries.slice(0, 8).map((query) => {
            const trackRecord = query.trackRecord;
            if (!trackRecord) return null;
            return (
              <article className="receipt-row" key={trackRecord.recordHash}>
                <div>
                  <strong>{query.question}</strong>
                  <span>
                    seq {trackRecord.seq} / {shortHash(trackRecord.botId)}
                  </span>
                </div>
                <div className="numeric-cell">
                  <strong>{shortHash(trackRecord.recordHash)}</strong>
                  <Link className="receipt-link" href={`/answers/${query.id}`}>
                    Open answer
                  </Link>
                  <a
                    className="receipt-link"
                    href={arcscanTxUrl(trackRecord.transaction)}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Arcscan tx
                  </a>
                </div>
              </article>
            );
          })}
        </section>
      )}

      {covenant?.latestVault && (
        <section className="receipt-ledger">
          <div className="panel-heading">
            <p className="eyebrow">Forum CovenantVault</p>
            <h3>Budget envelope</h3>
          </div>
          <div className="evidence-grid">
            <div className="evidence-row">
              <span>vault</span>
              <strong>{covenant.latestVault.address}</strong>
            </div>
            <div className="evidence-row">
              <span>operator</span>
              <strong>{covenant.latestVault.mandate.operator}</strong>
            </div>
            <div className="evidence-row">
              <span>state</span>
              <strong>{covenant.latestVault.state}</strong>
            </div>
            <div className="evidence-row">
              <span>budget</span>
              <strong>
                {formatAtomicUsdc(covenant.latestVault.mandate.budgetUsdc)} USDC
              </strong>
            </div>
            <div className="evidence-row">
              <span>available credit</span>
              <strong>
                {formatAtomicUsdc(covenant.latestVault.availableCredit)} USDC
              </strong>
            </div>
            <div className="evidence-row">
              <span>outstanding</span>
              <strong>
                {formatAtomicUsdc(covenant.latestVault.operatorOutstanding)}{" "}
                USDC
              </strong>
            </div>
            <div className="evidence-row">
              <span>risk kernel</span>
              <strong>{covenant.latestVault.mandate.riskKernel}</strong>
            </div>
            <div className="evidence-row">
              <span>bond contract</span>
              <strong>{covenant.latestVault.mandate.bondContract}</strong>
            </div>
          </div>
        </section>
      )}

      {slashBond && (
        <section className="receipt-ledger">
          <div className="panel-heading">
            <p className="eyebrow">Forum SlashBond</p>
            <h3>Reputation collateral</h3>
          </div>
          <div className="evidence-grid">
            <div className="evidence-row">
              <span>bond contract</span>
              <strong>{slashBond.address}</strong>
            </div>
            <div className="evidence-row">
              <span>operator</span>
              <strong>{slashBond.operator}</strong>
            </div>
            <div className="evidence-row">
              <span>attestor</span>
              <strong>{slashBond.attestor}</strong>
            </div>
            <div className="evidence-row">
              <span>bot id</span>
              <strong>{slashBond.botId}</strong>
            </div>
            <div className="evidence-row">
              <span>bond balance</span>
              <strong>{formatAtomicUsdc(slashBond.bondBalance)} USDC</strong>
            </div>
            <div className="evidence-row">
              <span>total slashed</span>
              <strong>{formatAtomicUsdc(slashBond.totalSlashed)} USDC</strong>
            </div>
            <div className="evidence-row">
              <span>unbond amount</span>
              <strong>{formatAtomicUsdc(slashBond.unbondAmount)} USDC</strong>
            </div>
            <div className="evidence-row">
              <span>recipient</span>
              <strong>{slashBond.recipient}</strong>
            </div>
          </div>
        </section>
      )}

      <section className="lower-grid">
        <div className="creator-table">
          <div className="panel-heading">
            <p className="eyebrow">creator leaderboard</p>
            <h3>Payouts</h3>
          </div>
          {creators.slice(0, 8).map((creator) => (
            <div className="creator-row" key={creator.wallet}>
              <div>
                <strong>{creator.creator}</strong>
                <span>
                  {creator.handle} / {shortWallet(creator.wallet)}
                </span>
              </div>
              <div className="numeric-cell">
                <strong>{formatUsdc(creator.earnedAtomicUsdc)}</strong>
                <Link
                  className="receipt-link"
                  href={`/creators/${creator.wallet}`}
                >
                  {creator.citationCount} citations
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div className="source-registry">
          <div className="panel-heading">
            <p className="eyebrow">source leaderboard</p>
            <h3>Inventory usage</h3>
          </div>
          <div className="source-list">
            {sourceLeaders.slice(0, 8).map((source) => (
              <article className="source-card" key={source.sourceId}>
                <div>
                  <p>{source.title}</p>
                  <span>
                    {source.creator} / {source.citationCount} citations
                  </span>
                </div>
                <div className="source-action">
                  <strong>{formatUsdc(source.earnedAtomicUsdc)} USDC</strong>
                  <Link
                    className="receipt-link"
                    href={`/sources/${source.sourceId}`}
                  >
                    View source
                  </Link>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="receipt-ledger">
        <div className="panel-heading">
          <p className="eyebrow">latest receipts</p>
          <h3>Chain tail</h3>
        </div>
        {ledger.receipts
          .slice()
          .reverse()
          .slice(0, 12)
          .map((receipt) => (
            <article className="receipt-row" key={receipt.receiptHash}>
              <div>
                <strong>{receipt.creator}</strong>
                <span>
                  {settlementLabel(receipt.settlementMode)} /{" "}
                  {receipt.paymentResource ??
                    `/api/sources/${receipt.sourceId}`}
                </span>
              </div>
              <div className="numeric-cell">
                <strong>{formatUsdc(receipt.amountAtomicUsdc)}</strong>
                <Link
                  className="receipt-link"
                  href={`/receipts/${receipt.receiptHash}`}
                >
                  {shortHash(receipt.receiptHash)}
                </Link>
              </div>
            </article>
          ))}
      </section>
    </main>
  );
}
