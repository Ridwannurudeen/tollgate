import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

const commands = [
  "npm ci",
  "npm run build",
  "sudo cp deploy/systemd/aperture.service /etc/systemd/system/aperture.service",
  "sudo cp deploy/systemd/aperture-watcher.service /etc/systemd/system/aperture-watcher.service",
  "sudo systemctl daemon-reload",
  "sudo systemctl enable --now aperture aperture-watcher",
];

export default function InstallPage() {
  return (
    <>
      <main className="shell compact">
        <SiteNav />

      <section className="pageHeader">
        <p className="eyebrow">VPS operator runbook</p>
        <h1>Run Aperture beside an existing Immich server.</h1>
        <p>
          The payment gate resolves each shared-link archive through Immich,
          settles mapped photographers, and writes the receipts. The access-log
          watcher only correlates completed downloads with those gate receipts.
        </p>
      </section>

      <section className="twoColumn">
        <div className="surface">
          <h2>1. Environment</h2>
          <p>
            Runtime settings live outside git in a root-owned environment file.
            The FeeRouter key stays absent until the payer wallet is funded.
          </p>
          <pre className="commandBlock">{`APERTURE_BASE_PATH=/aperture
APERTURE_IMMICH_API_BASE_URL=http://127.0.0.1:2283/api
APERTURE_ACCESS_LOG=/var/log/nginx/access.log
APERTURE_LICENSE_FEE_ATOMIC_USDC=2500
APERTURE_FEE_ROUTER_ENABLED=0
APERTURE_SESSION_SECRET=<openssl rand -hex 32>`}</pre>
        </div>

        <div className="surface">
          <h2>2. Services</h2>
          <div className="steps">
            {commands.map((command) => (
              <code key={command}>{command}</code>
            ))}
          </div>
        </div>
      </section>

      <section className="surface wide">
        <h2>Tollgate mount</h2>
        <p>
          Aperture is served at `https://tollgate.gudman.xyz/aperture`. Tollgate
          also exposes `/immich/api/download/archive`. Its exact nginx location
          must keep the Aperture authorization subrequest; the watcher observes
          only successful authorized downloads.
        </p>
      </section>
      </main>
      <SiteFooter />
    </>
  );
}
