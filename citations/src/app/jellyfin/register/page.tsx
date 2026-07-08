import Link from "next/link";
import { CopySnippet } from "@/components/CopySnippet";
import { JellyfinRegisterPanel } from "@/components/JellyfinRegisterPanel";
import { SiteNav } from "@/components/SiteNav";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const WEBHOOK_URL =
  "https://tollgate.gudman.xyz/jellyfin/api/webhooks/jellyfin";

export default async function JellyfinRegisterPage() {
  const ledger = await readLedger();
  const verification = verifyLedgerIntegrity(ledger);

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell" id="main">
        <section className="route-hero">
          <div>
            <p className="eyebrow">jellyfin onboarding</p>
            <h1>Connect Jellyfin with the official Webhook plugin.</h1>
          </div>
          <div className="route-hero-copy">
            <p className="hero-text">
              Register a media item, copy one API key, and point Jellyfin's
              Webhook plugin at Tollgate's hosted sidecar. PlaybackStart and
              PlaybackStop events become watched-minute receipts.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>sidecar</span>
                <strong>hosted</strong>
              </div>
              <div className="metric">
                <span>webhook</span>
                <strong>official plugin</strong>
              </div>
              <div className="metric wide">
                <span>settlement</span>
                <strong>FeeRouter receipts</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="register-route-grid">
          <JellyfinRegisterPanel />
          <aside className="register-rail">
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">webhook install</p>
                <h3>Point Jellyfin at Tollgate</h3>
              </div>
              <ol className="registration-next-list">
                <li>
                  In Jellyfin, open Dashboard -&gt; Plugins -&gt; Catalog and
                  install the official Webhook plugin.
                </li>
                <li>
                  Restart Jellyfin, then add a Generic webhook destination.
                </li>
                <li>Enable Playback Start and Playback Stop.</li>
                <li>Enable Send All Properties.</li>
                <li>
                  Add header <code>X-Tollgate-Key</code> with the one-time key
                  returned by this page.
                </li>
              </ol>
            </div>
            <div className="receipt-context profile-section snippet-grid">
              <div className="panel-heading">
                <p className="eyebrow">copy into jellyfin</p>
                <h3>Hosted sidecar values</h3>
              </div>
              <CopySnippet label="destination url" value={WEBHOOK_URL} />
              <CopySnippet label="header name" value="X-Tollgate-Key" />
            </div>
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">proof</p>
                <h3>What will change after a real event</h3>
              </div>
              <p className="hero-text">
                The public Jellyfin proof page currently labels its FeeRouter
                receipt as a fixture replay. Once your Webhook plugin posts a
                non-fixture PlaybackStop for a registered item, the proof feed
                can show a real Jellyfin webhook receipt.
              </p>
              <Link className="receipt-link" href="/jellyfin/api/proof">
                View Jellyfin proof feed
              </Link>
            </div>
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">docs</p>
                <h3>Official plugin reference</h3>
              </div>
              <Link
                className="receipt-link"
                href="https://jellyfin.org/docs/general/server/notifications/"
              >
                Jellyfin notification docs
              </Link>
              <Link className="receipt-link" href="/jellyfin">
                Open Jellyfin proof dashboard
              </Link>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}
