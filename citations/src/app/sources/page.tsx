import Link from "next/link";
import { SiteNav } from "@/components/SiteNav";
import { SourceCard } from "@/components/SourceCard";
import { readSources } from "@/lib/catalog";
import { readLedger, verifyLedgerIntegrity } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [sources, ledger] = await Promise.all([readSources(), readLedger()]);
  const verification = verifyLedgerIntegrity(ledger);
  const externalCount = sources.filter(
    (source) => source.sourceKind === "external",
  ).length;
  const verifiedCount = sources.filter(
    (source) => source.verifiedCreator,
  ).length;

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <main className="shell" id="main">
        <section className="route-hero">
          <div className="route-hero-copy">
            <p className="eyebrow">source catalog</p>
            <h1>Browse every registered work Tollgate can pay.</h1>
            <p className="hero-text">
              Public sources include seed demos, verified creators, and
              probationary self-registered work waiting for domain ownership
              proof.
            </p>
          </div>
          <div className="signature-stat">
            <span className="stamp">Catalog</span>
            <span className="stat-label">registered sources</span>
            <strong>{sources.length}</strong>
            <span className="stat-unit">
              {verifiedCount} verified / {externalCount} external
            </span>
          </div>
        </section>

        {sources.length > 0 ? (
          <section className="source-catalog-grid">
            {sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </section>
        ) : (
          <section className="empty-state">
            <strong>No sources registered yet.</strong>
            <span>Register work before the catalog can route payments.</span>
            <Link className="receipt-link" href="/register">
              Register a source
            </Link>
          </section>
        )}
      </main>
    </>
  );
}
