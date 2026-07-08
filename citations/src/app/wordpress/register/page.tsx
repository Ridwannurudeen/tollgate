import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { WordPressRegisterPanel } from "@/components/WordPressRegisterPanel";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function WordPressRegisterPage() {
  const ledger = await readLedger();
  const verification = verifyLedgerIntegrity(ledger);

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell" id="main">
        <section className="route-hero">
          <div>
            <p className="eyebrow">wordpress onboarding</p>
            <h1>Gate a WordPress post without writing code.</h1>
          </div>
          <div className="route-hero-copy">
            <p className="hero-text">
              Register your site, copy one API key, upload the Tollgate plugin,
              and choose which posts readers or AI agents must pay to unlock.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>plugin</span>
                <strong>0.1.0</strong>
              </div>
              <div className="metric">
                <span>chain</span>
                <strong>Arc</strong>
              </div>
              <div className="metric wide">
                <span>settlement</span>
                <strong>USDC receipts</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="register-route-grid">
          <WordPressRegisterPanel />
          <aside className="register-rail">
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">plugin install</p>
                <h3>Upload the zip in WordPress</h3>
              </div>
              <ol className="registration-next-list">
                <li>
                  <a className="receipt-link" href="/tollgate.zip" download>
                    Download tollgate.zip
                  </a>
                </li>
                <li>Open WordPress, then go to Plugins -&gt; Add New.</li>
                <li>Click Upload Plugin, choose the zip, then activate it.</li>
                <li>Open Settings -&gt; Tollgate and paste the API key.</li>
                <li>Open any post and check Gate this post with Tollgate.</li>
              </ol>
            </div>
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">what the plugin does</p>
                <h3>Content gate only, no wallet code in PHP</h3>
              </div>
              <p className="hero-text">
                The WordPress plugin gates selected posts and calls Tollgate's
                hosted settlement API. FeeRouter routing, receipt hashes, and
                Arc USDC settlement stay in the Node app.
              </p>
              <Link className="receipt-link" href="/api/wordpress/proof">
                View WordPress proof feed
              </Link>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}
