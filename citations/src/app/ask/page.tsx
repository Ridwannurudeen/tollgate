import Link from "next/link";
import { AskWorkbench } from "@/components/AskWorkbench";
import { SiteNav } from "@/components/SiteNav";
import { formatDollars, shortHash } from "@/lib/format";
import { buildProofPack } from "@/lib/proof-pack";
import { latestShowcaseQuery } from "@/lib/query-display";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const proof = await buildProofPack();
  const ledger = { queries: proof.queries, receipts: proof.receipts };
  const verification = proof.integrity;
  const latestQuery = latestShowcaseQuery(ledger.queries);
  const actorMetrics = proof.traction.actorMetrics;

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
                <span>independent paid queries</span>
                <strong>{actorMetrics.independent.paymentCount}</strong>
              </div>
              <div className="metric">
                <span>independent reader volume</span>
                <strong>
                  {formatDollars(actorMetrics.independent.atomicUsdc)}
                </strong>
              </div>
              <div className="metric">
                <span>total reader volume</span>
                <strong>{formatDollars(actorMetrics.total.atomicUsdc)}</strong>
              </div>
              <div className="metric">
                <span>creator receipts</span>
                <strong>{ledger.receipts.length}</strong>
              </div>
              <div className="metric">
                <span>creator receipt volume</span>
                <strong>
                  {formatDollars(proof.traction.totalTestAtomicUsdc)}
                </strong>
              </div>
              <div className="metric wide">
                <span>showcased answer</span>
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
            <h3>Run the verified sponsor-funded judge flow</h3>
          </div>
          <p className="hero-text">
            This one-button operator-sponsored run executes the judge path
            end-to-end: live LLM source selection, reader-paid settlement, claim
            verification, and on-chain evidence.
          </p>
          <Link className="receipt-link" href="/demo">
            Open the judge demo
          </Link>
        </div>
      </main>
    </>
  );
}
