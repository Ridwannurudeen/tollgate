import { readFile } from "node:fs/promises";
import path from "node:path";
import Link from "next/link";
import { CopySnippet } from "@/components/CopySnippet";
import { SiteNav } from "@/components/SiteNav";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

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

const AUTH_COMMAND =
  "peertube-cli auth add -u 'https://your.peertube' -U 'root' --password '...'";

const WALLET_MAPPING = `videoUuid=0x1111111111111111111111111111111111111111
anotherVideoUuid=0x2222222222222222222222222222222222222222`;

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

export default async function PeerTubeRegisterPage() {
  const [ledger, pluginPackage] = await Promise.all([
    readLedger(),
    readPluginPackage(),
  ]);
  const verification = verifyLedgerIntegrity(ledger);
  const installCommand = `peertube-cli plugins install --npm-name ${pluginPackage.name}`;

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell" id="main">
        <section className="route-hero">
          <div>
            <p className="eyebrow">peertube onboarding</p>
            <h1>Install the Tollgate plugin on your PeerTube server.</h1>
          </div>
          <div className="route-hero-copy">
            <p className="hero-text">
              PeerTube has a native plugin surface, so this integration installs
              inside your PeerTube admin. Tollgate does not host a public
              PeerTube instance; operators attach the published package to
              their own server.
            </p>
            <div className="metrics-band profile-metrics">
              <div className="metric">
                <span>package</span>
                <strong>{pluginPackage.name}</strong>
              </div>
              <div className="metric">
                <span>version</span>
                <strong>{pluginPackage.version}</strong>
              </div>
              <div className="metric wide">
                <span>PeerTube</span>
                <strong>{pluginPackage.engine?.peertube ?? ">=6.0.0"}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="register-route-grid">
          <div className="source-registry">
            <div className="panel-heading">
              <p className="eyebrow">plugin install</p>
              <h3>Copy into your PeerTube operator shell</h3>
            </div>
            <div className="register-source-form snippet-grid">
              <CopySnippet label="authenticate cli" value={AUTH_COMMAND} />
              <CopySnippet label="install from npm" value={installCommand} />
              <CopySnippet label="creator wallet mapping" value={WALLET_MAPPING} />
            </div>
          </div>
          <aside className="register-rail">
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">admin settings</p>
                <h3>Configure creator payouts</h3>
              </div>
              <ol className="registration-next-list">
                <li>
                  Set Default creator wallet for videos without an explicit
                  mapping.
                </li>
                <li>
                  Set Creator wallet mapping with one{" "}
                  <code>videoUuid=0xWallet</code> entry per line.
                </li>
                <li>
                  Set Price per unlock in atomic USDC. <code>2500</code> is
                  0.0025 USDC.
                </li>
                <li>Keep Gate downloads enabled to block unpaid downloads.</li>
                <li>
                  Add an Operator private key only when the instance is funded
                  and ready to route on-chain payouts.
                </li>
              </ol>
            </div>
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">verify</p>
                <h3>Open your instance proof route</h3>
              </div>
              <p className="hero-text">
                On your PeerTube host, the plugin exposes
                `/plugins/tollgate/router/proof` with receipt count, routed
                atomic USDC, chain status, and per-video receipts.
              </p>
              <CopySnippet
                label="proof path"
                value="/plugins/tollgate/router/proof"
              />
            </div>
            <div className="receipt-context profile-section">
              <div className="panel-heading">
                <p className="eyebrow">package</p>
                <h3>Published plugin</h3>
              </div>
              <Link
                className="receipt-link"
                href={`https://www.npmjs.com/package/${pluginPackage.name}`}
              >
                {pluginPackage.name}@{pluginPackage.version}
              </Link>
              <Link className="receipt-link" href="/video">
                Open PeerTube proof mirror
              </Link>
            </div>
          </aside>
        </section>
      </main>
    </>
  );
}
