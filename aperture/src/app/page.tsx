import Link from "next/link";
import { SiteFooter } from "../components/SiteFooter";
import { SiteNav } from "../components/SiteNav";
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
    <>
      <main className="shell">
        <SiteNav />

      <section className="hero">
        <div>
          <p className="eyebrow">Pay-per-media licensing on Arc</p>
          <h1>Photographers get paid when their photos and videos are licensed.</h1>
          <p className="lede">
            Aperture gates uploaded photos, uploaded videos, and hosted photo
            URLs behind a receipt-checked paywall, then writes a payout to the
            owner that settles through Forum FeeRouter on Arc. It also runs as a
            sidecar for Immich photo communities, watching shared-link downloads
            the same way.
          </p>
          <div className="actions">
            <Link className="button primary" href="/link">
              Gate media
            </Link>
            <Link className="button" href="/browse">
              Browse works
            </Link>
            <Link className="button" href="/proof">
              Inspect proof
            </Link>
            <a className="button" href="https://immich.app">
              Immich
            </a>
          </div>
        </div>
        <div className="heroPanel" aria-label="Live licensing stats">
          <div className="liveRow">
            <span className="liveDot" />
            live on Arc testnet
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
          <p>
            The sidecar pattern is platform-portable: any media platform that
            exposes download events can pay its creators this way. Immich is the
            live integration today.
          </p>
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
          <Link href="/link">
            <span>Gate media</span>
            <small>upload photos or videos without Immich</small>
          </Link>
        </div>
      </section>
      </main>
      <SiteFooter />
    </>
  );
}
