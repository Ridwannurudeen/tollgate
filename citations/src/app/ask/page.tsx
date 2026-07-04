import Link from "next/link";
import { AskWorkbench } from "@/components/AskWorkbench";
import { SiteNav } from "@/components/SiteNav";
import { formatDollars, shortHash } from "@/lib/format";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

function totalPaid(ledger: Awaited<ReturnType<typeof readLedger>>): number {
  return ledger.receipts.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );
}

export default async function AskPage() {
  const ledger = await readLedger();
  const verification = verifyLedgerIntegrity(ledger);
  const latestQuery = ledger.queries[0] ?? null;

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell" id="main">
        <section className="route-hero ask-route-hero">
          <div>
            <p className="eyebrow">answer workbench</p>
            <h1>Ask the AI. Watch the citations get paid.</h1>
          </div>
          <div className="route-hero-copy">
            <p className="hero-text">
              The workbench prices registered sources, writes a grounded answer,
              and links the result to attribution receipts.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>answers</span>
                <strong>{ledger.queries.length}</strong>
              </div>
              <div className="metric">
                <span>receipts</span>
                <strong>{ledger.receipts.length}</strong>
              </div>
              <div className="metric">
                <span>paid out</span>
                <strong>{formatDollars(totalPaid(ledger))}</strong>
              </div>
              <div className="metric wide">
                <span>latest</span>
                <strong>
                  {latestQuery ? shortHash(latestQuery.answerHash) : "none"}
                </strong>
              </div>
            </div>
          </div>
        </section>
        <AskWorkbench initialLedger={ledger} />
        <div className="receipt-context profile-section ask-demo-pointer">
          <div className="panel-heading">
            <p className="eyebrow">judge demo</p>
            <h3>See the full reasoning trace and on-chain anchors</h3>
          </div>
          <p className="hero-text">
            The judge demo runs the same agent loop end to end with Forum
            TrackRecord, CovenantVault, and SlashBond evidence attached.
          </p>
          <Link className="receipt-link" href="/demo">
            Open the judge demo →
          </Link>
        </div>
      </main>
    </>
  );
}
