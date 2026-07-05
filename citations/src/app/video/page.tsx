import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { arcscanTxUrl } from "@/lib/format";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const PEERTUBE_PAYOUT_TX =
  "0x1ed2e7caa90964100d843095acc4f3e5c5f5bf9203850e91d2cab8f838c1a49d";
const FEE_ROUTER = "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59";

type PluginPackage = {
  name: string;
  version: string;
  description: string;
  engine?: { peertube?: string };
  engines?: { node?: string };
};

const FALLBACK_PLUGIN: PluginPackage = {
  name: "peertube-plugin-tollgate",
  version: "0.1.0",
  description:
    "Pay the creator in USDC on Arc when their video is downloaded. A permissionless PeerTube payments plugin.",
  engine: { peertube: ">=6.0.0" },
  engines: { node: ">=20" },
};

async function readPluginPackage(): Promise<PluginPackage> {
  try {
    const raw = await readFile(
      path.join(
        process.cwd(),
        "..",
        "peertube-plugin-tollgate",
        "package.json",
      ),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<PluginPackage>;
    if (!parsed.name || !parsed.version || !parsed.description) {
      return FALLBACK_PLUGIN;
    }
    return {
      name: parsed.name,
      version: parsed.version,
      description: parsed.description,
      engine: parsed.engine,
      engines: parsed.engines,
    };
  } catch {
    return FALLBACK_PLUGIN;
  }
}

export default async function VideoPage() {
  const [ledger, pluginPackage] = await Promise.all([
    readLedger(),
    readPluginPackage(),
  ]);
  const verification = verifyLedgerIntegrity(ledger);

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell receipt-page" id="main">
        <header className="receipt-header">
          <div>
            <p className="eyebrow">video licensing</p>
            <h1>PeerTube downloads can pay creators per unlock.</h1>
          </div>
          <Link className="wallet-button receipt-back" href="/core">
            Settlement core
          </Link>
        </header>

        <section className="receipt-proof">
          <div className="signature-stat proof-stat">
            <span className="stamp">Video</span>
            <span className="stat-label">plugin package</span>
            <strong>{pluginPackage.version}</strong>
            <span className="stat-unit">
              PeerTube {pluginPackage.engine?.peertube ?? ">=6.0.0"}
            </span>
          </div>
          <div className="proof-copy">
            <p className="eyebrow">integration 03 / PeerTube</p>
            <h2>Gate a download, route USDC, write a receipt.</h2>
            <p className="hero-text">
              {pluginPackage.description} The same settlement primitive behind
              paid citations and photo licensing can attach to a self-hosted
              video community without upstream changes.
            </p>
          </div>
        </section>

        <section className="metrics-band profile-metrics">
          <div className="metric">
            <span>package</span>
            <strong>{pluginPackage.name}</strong>
          </div>
          <div className="metric">
            <span>version</span>
            <strong>{pluginPackage.version}</strong>
          </div>
          <div className="metric">
            <span>PeerTube</span>
            <strong>{pluginPackage.engine?.peertube ?? ">=6.0.0"}</strong>
          </div>
          <div className="metric">
            <span>Node</span>
            <strong>{pluginPackage.engines?.node ?? ">=20"}</strong>
          </div>
          <div className="metric wide">
            <span>settlement</span>
            <strong>USDC on Arc</strong>
          </div>
        </section>

        <section className="evidence-grid">
          <div className="evidence-row">
            <span>npm package</span>
            <strong>
              <a
                href={`https://www.npmjs.com/package/${pluginPackage.name}`}
                target="_blank"
                rel="noreferrer"
              >
                {pluginPackage.name}@{pluginPackage.version}
              </a>
            </strong>
          </div>
          <div className="evidence-row">
            <span>creator payout tx (plugin FeeRouter.pay)</span>
            <strong>
              <a
                href={arcscanTxUrl(PEERTUBE_PAYOUT_TX)}
                target="_blank"
                rel="noreferrer"
              >
                {PEERTUBE_PAYOUT_TX}
              </a>
            </strong>
          </div>
          <div className="evidence-row">
            <span>FeeRouter tx status</span>
            <strong>success</strong>
          </div>
          <div className="evidence-row">
            <span>fee router</span>
            <strong>
              <a
                href={`https://testnet.arcscan.app/address/${FEE_ROUTER}`}
                target="_blank"
                rel="noreferrer"
              >
                {FEE_ROUTER}
              </a>
            </strong>
          </div>
          <div className="evidence-row">
            <span>proof endpoint</span>
            <strong>/plugins/tollgate/router/proof</strong>
          </div>
          <div className="evidence-row">
            <span>plugin validation</span>
            <strong>
              Download gating, config, and /router/proof are validated against
              a running PeerTube 8.2.2 instance (demo/VALIDATION.md); the
              plugin's own payout routine settled the creator payout above on
              Arc, routing USDC to the creator's FeeRouter split (claimable,
              like every Tollgate lane).
            </strong>
          </div>
        </section>

        <section className="receipt-context profile-section">
          <div className="panel-heading">
            <p className="eyebrow">how it attaches</p>
            <h3>
              PeerTube emits the paid event; Tollgate records the receipt.
            </h3>
          </div>
          <div className="step-grid">
            <article className="step-card">
              <span className="step-index" aria-hidden="true">
                01
              </span>
              <h3>Configure wallets</h3>
              <p>
                The plugin maps video ids to creator wallets, with a default
                wallet for videos without an explicit mapping.
              </p>
            </article>
            <article className="step-card">
              <span className="step-index" aria-hidden="true">
                02
              </span>
              <h3>Gate downloads</h3>
              <p>
                Downloads can require the configured atomic-USDC price before
                the viewer receives the media file.
              </p>
            </article>
            <article className="step-card">
              <span className="step-index" aria-hidden="true">
                03
              </span>
              <h3>Verify receipts</h3>
              <p>
                The plugin proof router exposes hash-chained receipts, with
                Arcscan links once operator settlement is enabled.
              </p>
            </article>
          </div>
        </section>
      </main>
    </>
  );
}
