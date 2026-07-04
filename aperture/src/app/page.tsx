import Link from "next/link";
import { ARC_EXPLORER_URL } from "../lib/chain";
import { readLicenseLedger, summarizeLedger } from "../lib/ledger";
import { readWalletRegistry } from "../lib/registry";

export const dynamic = "force-dynamic";

function formatUsdc(value: number) {
  return (value / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export default async function Home() {
  const [ledger, registry] = await Promise.all([
    readLicenseLedger(),
    readWalletRegistry(),
  ]);
  const creators = summarizeLedger(ledger);
  const totalEarned = creators.reduce(
    (sum, creator) => sum + creator.earned,
    0,
  );

  return (
    <main className="shell">
      <nav className="topbar">
        <div className="brand">Aperture</div>
        <div className="navlinks">
          <a href="https://tollgate.gudman.xyz">Citations app</a>
          <Link href="/proof">Proof</Link>
          <Link href="/install">Install</Link>
          <Link href="/onboarding">Onboarding</Link>
          <a href={ARC_EXPLORER_URL}>Arcscan</a>
        </div>
      </nav>

      <section className="hero">
        <div>
          <p className="eyebrow">Immich sidecar / verified download path</p>
          <h1>Photographers get paid when shared photos are downloaded.</h1>
          <p className="lede">
            Aperture watches Immich shared-link downloads, resolves the asset
            owner, and writes a payout receipt that can settle through Forum
            FeeRouter on Arc.
          </p>
          <div className="actions">
            <Link className="button primary" href="/proof">
              Inspect proof
            </Link>
            <Link className="button" href="/download">
              Download trigger
            </Link>
            <a className="button" href="https://immich.app">
              Immich
            </a>
          </div>
        </div>
        <div className="heroPanel" aria-label="Live licensing stats">
          <div className="liveRow">
            <span className="liveDot" />
            verified Immich v2.7.5 flow
          </div>
          <div className="bigNumber">{ledger.receipts.length}</div>
          <div className="panelLabel">licensed downloads recorded</div>
          <div className="metricGrid">
            <div>
              <span>{registry.photographers.length}</span>
              <small>owners mapped</small>
            </div>
            <div>
              <span>{formatUsdc(totalEarned)}</span>
              <small>USDC routed</small>
            </div>
          </div>
        </div>
      </section>

      <section className="flow">
        {[
          ["01", "Download click", "POST /api/download/archive?key=..."],
          ["02", "Resolve owner", "GET /api/shared-links/me?key=..."],
          ["03", "Map wallet", "Immich ownerId to Arc wallet registry"],
          ["04", "Settle", "Forum FeeRouterV1 or local proof receipt"],
        ].map(([step, title, body]) => (
          <div className="flowCard" key={step}>
            <span>{step}</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
        ))}
      </section>

      <section className="operatorBand">
        <div>
          <p className="eyebrow">Operator-ready sidecar</p>
          <h2>Install beside Immich without upstream patches.</h2>
        </div>
        <div className="operatorGrid">
          <Link href="/api/health">
            <span>Health JSON</span>
            <small>Immich ping, ledger status, owner count</small>
          </Link>
          <Link href="/api/proof">
            <span>Proof API</span>
            <small>Hash chain, receipts, payouts, registry</small>
          </Link>
          <Link href="/install">
            <span>VPS install</span>
            <small>systemd, nginx, access-log watcher</small>
          </Link>
          <Link href="/download">
            <span>Public trigger</span>
            <small>same-host Immich archive download path</small>
          </Link>
        </div>
      </section>
    </main>
  );
}
