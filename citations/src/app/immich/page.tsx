import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { formatDollars } from "@/lib/format";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const APERTURE_PROOF_URL = "https://tollgate.gudman.xyz/aperture/api/proof";
const IMMICH_CONFIG_URL =
  "https://tollgate.gudman.xyz/immich/api/server/config";

type ApertureProof = {
  verification: { ok: boolean; receiptCount: number };
  totals: {
    receipts: number;
    registeredOwners: number;
    totalEarnedAtomicUsdc: number;
    licenseFeeAtomicUsdc: number;
  };
  settlement: { feeRouterEnabled: boolean; immichApiBaseUrl?: string };
  creators: { wallet: string; photographer: string; earned: number }[];
};

async function loadAperture(): Promise<ApertureProof | null> {
  try {
    const res = await fetch(APERTURE_PROOF_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ApertureProof;
  } catch {
    return null;
  }
}

async function loadImmichConfig(): Promise<boolean> {
  try {
    const res = await fetch(IMMICH_CONFIG_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default async function ImmichPage() {
  const [ledger, aperture, immichApiReachable] = await Promise.all([
    readLedger(),
    loadAperture(),
    loadImmichConfig(),
  ]);
  const verification = verifyLedgerIntegrity(ledger);

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell receipt-page" id="main">
        <header className="receipt-header">
          <div>
            <p className="eyebrow">immich shared-link sidecar</p>
            <h1>Immich downloads feed the same creator-payment ledger.</h1>
          </div>
          <Link className="wallet-button receipt-back" href="/core">
            Settlement core
          </Link>
        </header>

        <section className="receipt-proof">
          <div className="signature-stat proof-stat">
            <span className="stamp">Immich</span>
            <span className="stat-label">public API</span>
            <strong>{immichApiReachable ? "reachable" : "offline"}</strong>
            <span className="stat-unit">via /immich/api</span>
          </div>
          <div className="proof-copy">
            <p className="eyebrow">legacy path / Aperture sidecar</p>
            <h2>Self-hosted photo downloads can become paid events.</h2>
            <p className="hero-text">
              The original Aperture sidecar watches Immich shared-link download
              events and maps the downloaded asset owner to a creator wallet.
              The standalone Immich subdomain is not DNS-routable today, so the
              public proof surface is exposed through the Tollgate host while
              the local Immich API remains mounted behind `/immich/api`.
            </p>
          </div>
        </section>

        <section className="metrics-band profile-metrics">
          <div className="metric">
            <span>downloads paid</span>
            <strong>{aperture?.totals.receipts ?? 0}</strong>
          </div>
          <div className="metric">
            <span>asset owners</span>
            <strong>{aperture?.totals.registeredOwners ?? 0}</strong>
          </div>
          <div className="metric">
            <span>per download</span>
            <strong>
              {formatDollars(aperture?.totals.licenseFeeAtomicUsdc ?? 0)}
            </strong>
          </div>
          <div className="metric wide">
            <span>payments recorded</span>
            <strong>
              {formatDollars(aperture?.totals.totalEarnedAtomicUsdc ?? 0)} USDC
            </strong>
          </div>
        </section>

        <section className="evidence-grid">
          <div className="evidence-row">
            <span>Aperture proof</span>
            <strong>
              <a href="/aperture/api/proof">/aperture/api/proof</a>
            </strong>
          </div>
          <div className="evidence-row">
            <span>Immich API mount</span>
            <strong>
              <a href="/immich/api/server/config">/immich/api/server/config</a>
            </strong>
          </div>
          <div className="evidence-row">
            <span>ledger integrity</span>
            <strong>
              {aperture?.verification.ok ? "verified" : "unavailable"} ·{" "}
              {aperture?.verification.receiptCount ?? 0} receipts
            </strong>
          </div>
          <div className="evidence-row">
            <span>settlement mode</span>
            <strong>
              {aperture?.settlement.feeRouterEnabled
                ? "FeeRouter enabled"
                : "local proof on current live Aperture service"}
            </strong>
          </div>
          <div className="evidence-row">
            <span>subdomain status</span>
            <strong>
              immich.gudman.xyz DNS is not configured; Tollgate-hosted
              `/immich/api` is the public surface for this pass.
            </strong>
          </div>
        </section>
      </main>
    </>
  );
}
