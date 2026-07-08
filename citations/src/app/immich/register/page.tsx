import Link from "next/link";
import { CopySnippet } from "@/components/CopySnippet";
import { ImmichRegisterPanel } from "@/components/ImmichRegisterPanel";
import { SiteNav } from "@/components/SiteNav";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const BUILD_COMMAND = `git clone https://github.com/Ridwannurudeen/tollgate.git
cd tollgate
docker build -f aperture/Dockerfile -t tollgate-immich-sidecar ./aperture`;

const ENV_FILE = `APERTURE_ACCESS_LOG=/var/log/nginx/access.log
APERTURE_IMMICH_API_BASE_URL=http://127.0.0.1:2283/api
APERTURE_LICENSE_FEE_ATOMIC_USDC=2500
APERTURE_FEE_ROUTER_ENABLED=1
APERTURE_FEE_ROUTER_PRIVATE_KEY=<operator-private-key>`;

const RUN_COMMAND = `docker volume create tollgate-aperture-data
docker run -d --name tollgate-immich-sidecar --restart unless-stopped --network host --env-file ./aperture.env -v /var/log/nginx/access.log:/var/log/nginx/access.log:ro -v tollgate-aperture-data:/app/data tollgate-immich-sidecar`;

const REGISTER_OWNER_COMMAND = `docker run --rm --network host --env-file ./aperture.env -v tollgate-aperture-data:/app/data tollgate-immich-sidecar npm run register:owner -- --owner-id 'immich-owner-uuid' --display-name 'Jane Lens' --wallet '0x...'`;

export default async function ImmichRegisterPage() {
  const ledger = await readLedger();
  const verification = verifyLedgerIntegrity(ledger);

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell" id="main">
        <section className="route-hero">
          <div>
            <p className="eyebrow">immich onboarding</p>
            <h1>Run the payout watcher beside your Immich server.</h1>
          </div>
          <div className="route-hero-copy">
            <p className="hero-text">
              Immich does not expose a payment plugin surface. Tollgate's
              Immich path is a co-located sidecar: it watches your nginx access
              log for shared-link archive downloads, resolves the assets through
              Immich's API, and pays registered owners.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>runtime</span>
                <strong>Docker sidecar</strong>
              </div>
              <div className="metric">
                <span>input</span>
                <strong>nginx access log</strong>
              </div>
              <div className="metric wide">
                <span>registry</span>
                <strong>owner ID to wallet</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="register-route-grid">
          <ImmichRegisterPanel />
          <aside className="register-rail">
            <div className="receipt-context profile-section snippet-grid">
              <div className="panel-heading">
                <p className="eyebrow">docker sidecar</p>
                <h3>Build and run beside Immich</h3>
              </div>
              <CopySnippet label="build image" value={BUILD_COMMAND} />
              <CopySnippet label="aperture.env" value={ENV_FILE} />
              <CopySnippet label="run watcher" value={RUN_COMMAND} />
            </div>
            <div className="receipt-context profile-section snippet-grid">
              <div className="panel-heading">
                <p className="eyebrow">owner mapping</p>
                <h3>Approve a creator wallet locally</h3>
              </div>
              <p className="hero-text">
                The command below writes an operator-approved mapping into the
                same `/app/data` volume used by the watcher container.
              </p>
              <CopySnippet
                label="register owner"
                value={REGISTER_OWNER_COMMAND}
              />
            </div>
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">hosted proof registry</p>
                <h3>Public Tollgate mapping form</h3>
              </div>
              <p className="hero-text">
                The form on this page writes to Tollgate's hosted Aperture
                registry. For your own Immich deployment, use the Docker volume
                and `register:owner` command above so the mapping lives beside
                your watcher.
              </p>
              <Link className="receipt-link" href="/aperture/api/proof">
                View Aperture proof feed
              </Link>
            </div>
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">boundary</p>
                <h3>Not remotely hosted</h3>
              </div>
              <p className="hero-text">
                WordPress and Jellyfin can call hosted Tollgate APIs. Immich
                download detection depends on the operator's nginx log, so the
                sidecar must run on the same host or log volume as Immich.
              </p>
              <Link className="receipt-link" href="/immich">
                Open Immich proof dashboard
              </Link>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}
