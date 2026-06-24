import Link from "next/link";

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
    <main className="shell compact">
      <nav className="topbar">
        <Link className="brand" href="/">
          Aperture
        </Link>
        <div className="navlinks">
          <Link href="/proof">Proof</Link>
          <Link href="/onboarding">Onboarding</Link>
        </div>
      </nav>

      <section className="pageHeader">
        <p className="eyebrow">VPS operator runbook</p>
        <h1>Run Aperture beside an existing Immich server.</h1>
        <p>
          The sidecar reads nginx access logs, resolves each shared-link archive
          download through Immich, and writes a public receipt for every mapped
          photographer.
        </p>
      </section>

      <section className="twoColumn">
        <div className="surface">
          <h2>1. Environment</h2>
          <p>
            Runtime settings live outside git in a root-owned environment file.
            The FeeRouter key stays absent until the payer wallet is funded.
          </p>
          <pre className="commandBlock">{`APERTURE_IMMICH_API_BASE_URL=http://127.0.0.1:2283/api
APERTURE_ACCESS_LOG=/var/log/nginx/access.log
APERTURE_LICENSE_FEE_ATOMIC_USDC=2500
APERTURE_FEE_ROUTER_ENABLED=0
APERTURE_EXIF_ENABLED=1`}</pre>
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
        <h2>DNS and TLS gate</h2>
        <p>
          `aperture.gudman.xyz` and `immich.gudman.xyz` must resolve to the VPS
          before certbot can issue certificates. The nginx files are staged in
          `deploy/nginx/`; use webroot certbot, then reload nginx.
        </p>
      </section>
    </main>
  );
}
