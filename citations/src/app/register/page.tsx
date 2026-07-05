import Link from "next/link";
import { EarningsBoard } from "@/components/EarningsBoard";
import { RegisterPanel } from "@/components/RegisterPanel";
import { SiteNav } from "@/components/SiteNav";
import { readSources } from "@/lib/catalog";
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

export default async function RegisterPage() {
  const [ledger, sources] = await Promise.all([readLedger(), readSources()]);
  const creators = summarizeCreators(ledger);
  const verification = verifyLedgerIntegrity(ledger);

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell" id="main">
        <section className="route-hero">
          <div>
            <p className="eyebrow">creator onboarding</p>
            <h1>Register work the answer agent can buy.</h1>
            <h2 className="sr-only">Registration and verification</h2>
          </div>
          <div className="route-hero-copy">
            <p className="hero-text">
              Add one priced source, import an RSS feed, or verify ownership.
              Tollgate records every citation payout against the creator wallet.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>creators paid</span>
                <strong>{creators.length}</strong>
              </div>
              <div className="metric">
                <span>receipts</span>
                <strong>{ledger.receipts.length}</strong>
              </div>
              <div className="metric wide">
                <span>payments recorded</span>
                <strong>{formatDollars(totalPaid(ledger))}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="register-route-grid">
          <RegisterPanel />
          <aside className="register-rail">
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">verification</p>
                <h3>Ownership unlocks payouts</h3>
              </div>
              <p className="hero-text">
                Wallet signatures, meta tags, or DNS TXT records can verify a
                source. Unverified work can be listed, but payouts stay
                probationary until ownership proof lands.
              </p>
              <Link className="receipt-link" href="/proof">
                Review proof surface
              </Link>
            </div>
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">custody</p>
                <h3>Self-custody first</h3>
              </div>
              <p className="hero-text">
                Paste an EVM wallet for the creator claim address. The server
                also supports Circle W3S custody when the operator enables the
                required environment.
              </p>
            </div>
            <EarningsBoard
              creators={creators}
              limit={4}
              eyebrow="earnings preview"
              heading="Current payouts"
              sources={sources}
            />
          </aside>
        </section>
      </main>
    </>
  );
}
