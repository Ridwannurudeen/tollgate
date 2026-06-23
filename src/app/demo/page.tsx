import Link from "next/link";
import { readCovenantEnvelope } from "@/lib/covenant";
import { formatUsdc, shortHash, shortWallet } from "@/lib/format";
import {
  getJudgeDemoEvidence,
  readLedger,
  verifyLedgerIntegrity,
} from "@/lib/ledger";
import {
  readDemoSlashBondEvidence,
  readSlashBondStatus,
} from "@/lib/slash-bond";
import type { AnswerEvidence, Ledger, PaymentReceipt } from "@/lib/types";

export const dynamic = "force-dynamic";

type DemoStep = {
  number: string;
  label: string;
  title: string;
  detail: string;
  value: string;
  href?: string;
  linkText: string;
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

function settlementLabel(mode: string): string {
  if (mode === "forum-routed") return "forum routed";
  if (mode === "x402-settled") return "x402 settled";
  if (mode === "x402-verified") return "x402 verified";
  return "local proof";
}

function arcscanTxUrl(tx: string): string {
  return `https://testnet.arcscan.app/tx/${tx}`;
}

function formatAtomicUsdc(value: bigint | string): string {
  return formatUsdc(Number(value));
}

function sourcePurchaseReceipt(
  evidence: AnswerEvidence | null,
): PaymentReceipt | null {
  if (!evidence) return null;
  return (
    evidence.receipts.find(
      (receipt) => receipt.settlementMode !== "local-proof",
    ) ??
    evidence.receipts[0] ??
    null
  );
}

function StepCard({ step }: { step: DemoStep }) {
  return (
    <article className="source-card">
      <div>
        <p>{step.title}</p>
        <span>
          {step.label} / {step.detail}
        </span>
      </div>
      <div className="source-action">
        <strong>
          {step.number} / {step.value}
        </strong>
        {step.href ? (
          <Link className="receipt-link" href={step.href}>
            {step.linkText}
          </Link>
        ) : (
          <span className="receipt-link">missing evidence</span>
        )}
      </div>
    </article>
  );
}

export default async function DemoPage() {
  const [ledger, covenant, slashBond, demoSlash] = await Promise.all([
    readLedger(),
    readCovenantEnvelope().catch(() => null),
    readSlashBondStatus().catch(() => null),
    readDemoSlashBondEvidence().catch(() => null),
  ]);
  const verification = verifyLedgerIntegrity(ledger);
  const demo = getJudgeDemoEvidence(ledger);
  const sourceReceipt = sourcePurchaseReceipt(demo.sourcePurchase);
  const verifiedReceiptCount = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "x402-verified",
  ).length;
  const forumRoutedReceiptCount = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "forum-routed",
  ).length;
  const settledReceiptCount = ledger.receipts.filter(
    (receipt) => receipt.settlementMode === "x402-settled",
  ).length;
  const trackRecordQueries = ledger.queries.filter(
    (query) => query.trackRecord,
  );
  const latestTrackRecordQuery = trackRecordQueries[0] ?? null;
  const latestTrackRecord = latestTrackRecordQuery?.trackRecord;
  const latestReceipt = ledger.receipts.at(-1);

  const steps: DemoStep[] = [
    {
      number: "01",
      label: "network proof",
      title: "Public payout ledger",
      detail: `${ledger.receipts.length} receipts / ${verification.issues.length} issues`,
      value: verification.ok ? "valid" : "review",
      href: "/proof",
      linkText: "Open proof",
    },
    {
      number: "02",
      label: "budgeted answer",
      title: demo.localAnswer?.query.question ?? "Local answer evidence",
      detail: demo.localAnswer
        ? `${demo.localAnswer.query.citations.length} citations / ${formatUsdc(
            demo.localAnswer.query.totalAtomicUsdc,
          )} USDC`
        : "no local answer",
      value: demo.localAnswer
        ? shortHash(demo.localAnswer.query.answerHash)
        : "missing",
      href: demo.localAnswer
        ? `/answers/${demo.localAnswer.query.id}`
        : undefined,
      linkText: "Open answer",
    },
    {
      number: "03",
      label: "reader-paid answer",
      title: demo.paidAnswer?.query.question ?? "x402 paid answer evidence",
      detail: demo.paidAnswer?.query.readerPayment
        ? `${settlementLabel(
            demo.paidAnswer.query.readerPayment.settlementMode,
          )} / ${formatUsdc(
            demo.paidAnswer.query.readerPayment.amountAtomicUsdc,
          )} USDC reader payment`
        : "no reader payment",
      value: demo.paidAnswer?.query.readerPayment
        ? shortHash(demo.paidAnswer.query.readerPayment.paymentHash)
        : "missing",
      href: demo.paidAnswer
        ? `/answers/${demo.paidAnswer.query.id}`
        : undefined,
      linkText: "Open paid answer",
    },
    {
      number: "04",
      label: "direct source purchase",
      title:
        demo.sourcePurchase?.query.citations[0]?.title ??
        "source purchase evidence",
      detail: sourceReceipt
        ? `${settlementLabel(sourceReceipt.settlementMode)} / ${formatUsdc(
            sourceReceipt.amountAtomicUsdc,
          )} USDC`
        : "no source receipt",
      value: sourceReceipt ? shortHash(sourceReceipt.receiptHash) : "missing",
      href: sourceReceipt
        ? `/receipts/${sourceReceipt.receiptHash}`
        : undefined,
      linkText: "Open receipt",
    },
    {
      number: "05",
      label: "Forum TrackRecord",
      title: latestTrackRecordQuery?.question ?? "answer anchor evidence",
      detail: latestTrackRecord
        ? `seq ${latestTrackRecord.seq} / ${shortHash(
            latestTrackRecord.transaction,
          )}`
        : "no TrackRecord",
      value: latestTrackRecord ? shortHash(latestTrackRecord.recordHash) : "missing",
      href: latestTrackRecordQuery
        ? `/answers/${latestTrackRecordQuery.id}`
        : undefined,
      linkText: "Open anchor",
    },
  ];

  return (
    <main className="shell receipt-page">
      <header className="receipt-header">
        <div>
          <p className="eyebrow">judge demo</p>
          <h1>Tollgate proof run</h1>
        </div>
        <div className="top-actions">
          <Link className="wallet-button receipt-back" href="/proof">
            Proof
          </Link>
          <Link className="wallet-button receipt-back" href="/">
            Back to Tollgate
          </Link>
        </div>
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
          <h2>{ledger.queries.length} answer events</h2>
          <p className="hero-text">
            This route turns the seeded ledger into a single judge path:
            aggregate proof, budgeted source selection, reader-paid answer, and
            direct source purchase.
          </p>
        </div>
      </section>

      <section className="metrics-band profile-metrics">
        <div className="metric">
          <span>receipts</span>
          <strong>{ledger.receipts.length}</strong>
        </div>
        <div className="metric">
          <span>x402 verified</span>
          <strong>{verifiedReceiptCount}</strong>
        </div>
        <div className="metric">
          <span>x402 settled</span>
          <strong>{settledReceiptCount}</strong>
        </div>
        <div className="metric">
          <span>Forum routed</span>
          <strong>{forumRoutedReceiptCount}</strong>
        </div>
        <div className="metric">
          <span>track records</span>
          <strong>{trackRecordQueries.length}</strong>
        </div>
        <div className="metric">
          <span>reader paid</span>
          <strong>{formatUsdc(totalReaderPaid(ledger))}</strong>
        </div>
        <div className="metric">
          <span>issues</span>
          <strong>{verification.issues.length}</strong>
        </div>
        <div className="metric">
          <span>slashed</span>
          <strong>
            {demoSlash
              ? formatAtomicUsdc(demoSlash.statusAfterSlash.totalSlashed)
              : slashBond
                ? formatAtomicUsdc(slashBond.totalSlashed)
                : "0.000000"}
          </strong>
        </div>
        <div className="metric wide">
          <span>latest hash</span>
          <strong>
            {latestReceipt ? shortHash(latestReceipt.receiptHash) : "none"}
          </strong>
        </div>
      </section>

      <section className="receipt-context profile-section">
        <div className="panel-heading">
          <p className="eyebrow">Forum proof stack</p>
          <h3>Live surfaces</h3>
        </div>
        <div className="source-list">
          {latestTrackRecord && latestTrackRecordQuery ? (
            <article className="source-card">
              <div>
                <p>TrackRecordV2 answer anchor</p>
                <span>
                  seq {latestTrackRecord.seq} /{" "}
                  {shortHash(latestTrackRecord.recordHash)}
                </span>
              </div>
              <div className="source-action">
                <strong>{shortHash(latestTrackRecord.transaction)}</strong>
                <Link
                  className="receipt-link"
                  href={`/answers/${latestTrackRecordQuery.id}`}
                >
                  Answer
                </Link>
                <a
                  className="receipt-link"
                  href={arcscanTxUrl(latestTrackRecord.transaction)}
                  rel="noreferrer"
                  target="_blank"
                >
                  Arcscan
                </a>
              </div>
            </article>
          ) : (
            <div className="empty-state compact">
              <strong>No TrackRecord evidence.</strong>
              <span>Run a gateway-enabled answer to publish one.</span>
            </div>
          )}

          {covenant?.latestVault ? (
            <article className="source-card">
              <div>
                <p>CovenantVault budget envelope</p>
                <span>
                  {covenant.latestVault.state} /{" "}
                  {shortWallet(covenant.latestVault.mandate.operator)}
                </span>
              </div>
              <div className="source-action">
                <strong>
                  {formatAtomicUsdc(covenant.latestVault.mandate.budgetUsdc)}{" "}
                  USDC
                </strong>
                <span className="receipt-link">
                  {shortWallet(covenant.latestVault.address)}
                </span>
              </div>
            </article>
          ) : (
            <div className="empty-state compact">
              <strong>No CovenantVault evidence.</strong>
              <span>Run the covenant proof script to create one.</span>
            </div>
          )}

          {demoSlash ? (
            <article className="source-card">
              <div>
                <p>SlashBond bad citation slash</p>
                <span>
                  {formatAtomicUsdc(demoSlash.slashAmountAtomicUsdc)} USDC /{" "}
                  {shortWallet(demoSlash.address)}
                </span>
              </div>
              <div className="source-action">
                <strong>
                  {formatAtomicUsdc(demoSlash.statusAfterSlash.totalSlashed)}{" "}
                  slashed
                </strong>
                <a
                  className="receipt-link"
                  href={arcscanTxUrl(demoSlash.slashTx)}
                  rel="noreferrer"
                  target="_blank"
                >
                  Slash tx
                </a>
              </div>
            </article>
          ) : (
            <div className="empty-state compact">
              <strong>No demo slash evidence.</strong>
              <span>Run npm run prove:slashbond-demo.</span>
            </div>
          )}
        </div>
      </section>

      <section className="receipt-context profile-section">
        <div className="panel-heading">
          <p className="eyebrow">proof sequence</p>
          <h3>Demo anchors</h3>
        </div>
        <div className="source-list">
          {steps.map((step) => (
            <StepCard key={step.number} step={step} />
          ))}
        </div>
      </section>

      <section className="lower-grid">
        <div className="creator-table">
          <div className="panel-heading">
            <p className="eyebrow">answer anchors</p>
            <h3>What to show</h3>
          </div>
          {[demo.localAnswer, demo.paidAnswer].map((evidence) =>
            evidence ? (
              <article className="receipt-row" key={evidence.query.id}>
                <div>
                  <strong>{evidence.query.question}</strong>
                  <span>
                    {evidence.query.readerPayment
                      ? settlementLabel(
                          evidence.query.readerPayment.settlementMode,
                        )
                      : "local proof"}{" "}
                    / {evidence.query.citations.length} citations
                  </span>
                </div>
                <div className="numeric-cell">
                  <strong>{formatUsdc(evidence.query.totalAtomicUsdc)}</strong>
                  <Link
                    className="receipt-link"
                    href={`/answers/${evidence.query.id}`}
                  >
                    {shortHash(evidence.query.answerHash)}
                  </Link>
                </div>
              </article>
            ) : null,
          )}
        </div>

        <div className="source-registry">
          <div className="panel-heading">
            <p className="eyebrow">source purchase</p>
            <h3>Direct source proof</h3>
          </div>
          {demo.sourcePurchase && sourceReceipt ? (
            <article className="source-card">
              <div>
                <p>{demo.sourcePurchase.query.citations[0]?.title}</p>
                <span>
                  {settlementLabel(sourceReceipt.settlementMode)} /{" "}
                  {sourceReceipt.createdAt}
                </span>
              </div>
              <div className="source-action">
                <strong>
                  {formatUsdc(sourceReceipt.amountAtomicUsdc)} USDC
                </strong>
                <Link
                  className="receipt-link"
                  href={`/sources/${sourceReceipt.sourceId}`}
                >
                  Source page
                </Link>
                <Link
                  className="receipt-link"
                  href={`/receipts/${sourceReceipt.receiptHash}`}
                >
                  {shortHash(sourceReceipt.receiptHash)}
                </Link>
              </div>
            </article>
          ) : (
            <div className="empty-state compact">
              <strong>No source purchase evidence.</strong>
              <span>The ledger has no direct source purchase yet.</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
