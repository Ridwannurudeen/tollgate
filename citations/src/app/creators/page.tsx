import Link from "next/link";
import { EarningsBoard } from "@/components/EarningsBoard";
import { ReceiptTicker } from "@/components/ReceiptTicker";
import { SiteNav } from "@/components/SiteNav";
import { formatDollars } from "@/lib/format";
import {
  readLedger,
  summarizeCreators,
  verifyLedgerIntegrity,
} from "@/lib/ledger";

export const dynamic = "force-dynamic";

function totalPaid(ledger: Awaited<ReturnType<typeof readLedger>>): number {
  return ledger.receipts.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );
}

export default async function CreatorsPage() {
  const ledger = await readLedger();
  const creators = summarizeCreators(ledger);
  const verification = verifyLedgerIntegrity(ledger);

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell" id="main">
        <section className="route-hero creators-route-hero">
          <div>
            <p className="eyebrow">creator earnings</p>
            <h1>Earnings board for paid citation receipts.</h1>
            <h2 className="sr-only">Creator leaderboard</h2>
          </div>
          <div className="route-hero-copy">
            <p className="hero-text">
              Each row links to a creator page with withdraw state, receipt
              history, source mix, and embed snippets.
            </p>
            <div className="hero-cta">
              <Link className="cta-primary" href="/register">
                Register your work
              </Link>
              <Link className="cta-secondary" href="/proof">
                Audit proof
              </Link>
            </div>
          </div>
        </section>

        <section className="metrics-band profile-metrics creators-summary">
          <div className="metric">
            <span>earning creators</span>
            <strong>{creators.length}</strong>
          </div>
          <div className="metric">
            <span>receipts</span>
            <strong>{ledger.receipts.length}</strong>
          </div>
          <div className="metric wide">
            <span>creator payouts</span>
            <strong>{formatDollars(totalPaid(ledger))}</strong>
          </div>
        </section>

        <ReceiptTicker receipts={ledger.receipts} />

        <section className="creators-board">
          <EarningsBoard creators={creators} heading="Creator leaderboard" />
        </section>
      </main>
    </>
  );
}
