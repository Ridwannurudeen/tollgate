import Link from "next/link";
import { readSources } from "@/lib/catalog";
import { readCovenantEnvelope } from "@/lib/covenant";
import { formatUsdc, shortHash, shortWallet } from "@/lib/format";
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

function totalReaderPaid(ledger: Ledger): number {
  return ledger.queries.reduce(
    (sum, query) => sum + (query.readerPayment?.amountAtomicUsdc ?? 0),
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

function settlementLabel(mode: string): string {
  if (mode === "forum-routed") return "forum routed";
  if (mode === "x402-settled") return "x402 settled";
  if (mode === "x402-verified") return "x402 verified";
  return "local proof";
}

function arcscanTxUrl(tx: string): string {
  return `https://testnet.arcscan.app/tx/${tx}`;
}

function formatAtomicUsdc(value: bigint): string {
  return formatUsdc(Number(value));
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
          <strong>{formatUsdc(totalReceiptPaid(ledger))}</strong>
          <span className="stat-unit">USDC</span>
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
          <strong>{formatUsdc(totalReaderPaid(ledger))}</strong>
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
            {slashBond ? formatAtomicUsdc(slashBond.bondBalance) : "0.000000"}
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
          <strong>{latestReceipt?.previousHash ?? "none"}</strong>
        </div>
      </section>

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
                {formatAtomicUsdc(covenant.latestVault.mandate.budgetUsdc)}{" "}
                USDC
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
