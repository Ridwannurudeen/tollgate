import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { ARC_EXPLORER_URL } from "@/lib/chain";
import { arcscanTxUrl } from "@/lib/format";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";
import { PEERTUBE_FEE_ROUTER_TX } from "@/lib/peertube-proof";

export const dynamic = "force-dynamic";

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
          <div className="hero-cta">
            <Link
              className="wallet-button primary receipt-back"
              href="/video/register"
            >
              Install plugin
            </Link>
            <Link className="wallet-button receipt-back" href="/core">
              Settlement core
            </Link>
          </div>
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
              {pluginPackage.description} Tollgate does not host a public
              PeerTube instance today; this page mirrors the local Docker
              validation and the shared Arc FeeRouter rail an operator can
              attach to their own PeerTube server.
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
            <span>public instance</span>
            <strong>not hosted</strong>
          </div>
        </section>

        <section className="evidence-grid">
          <div className="evidence-row">
            <span>operator setup</span>
            <strong>
              <a href="/video/register">/video/register</a>
            </strong>
          </div>
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
            <span>shared FeeRouter rail tx</span>
            <strong>
              <a
                href={arcscanTxUrl(PEERTUBE_FEE_ROUTER_TX)}
                target="_blank"
                rel="noreferrer"
              >
                {PEERTUBE_FEE_ROUTER_TX}
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
                href={`${ARC_EXPLORER_URL}/address/${FEE_ROUTER}`}
                target="_blank"
                rel="noreferrer"
              >
                {FEE_ROUTER}
              </a>
            </strong>
          </div>
          <div className="evidence-row">
            <span>proof mirror</span>
            <strong>
              <a href="/plugins/tollgate/router/proof">
                /plugins/tollgate/router/proof
              </a>
            </strong>
          </div>
          <div className="evidence-row">
            <span>plugin validation</span>
            <strong>
              Download gating, config, and /router/proof are validated against a
              running local PeerTube demo instance (demo/VALIDATION.md). That
              validation ran with payouts disabled and produced zero plugin
              receipts. The tx above proves the shared FeeRouter rail through
              plugin settlement code, not a public PeerTube-instance receipt.
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
                A live operator instance exposes hash-chained plugin receipts,
                with Arcscan links once its own operator key and creator wallet
                mapping are configured.
              </p>
            </article>
          </div>
        </section>
      </main>
    </>
  );
}
