import Link from "next/link";
import { APERTURE_IMMICH_API_BASE_URL } from "../../lib/config";
import { resolveSharedLink } from "../../lib/immich";
import { DownloadArchiveButton } from "./DownloadArchiveButton";

export const dynamic = "force-dynamic";

type DownloadPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function stringParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function DownloadPage({
  searchParams,
}: DownloadPageProps) {
  const params = await searchParams;
  const key = stringParam(params.key);
  const sharedLink = key
    ? await resolveSharedLink(APERTURE_IMMICH_API_BASE_URL, key).catch(
        () => null,
      )
    : null;
  const assetIds = sharedLink?.assets.map((asset) => asset.id) ?? [];

  return (
    <main className="shell compact">
      <nav className="topbar">
        <Link className="brand" href="/">
          Aperture
        </Link>
        <div className="navlinks">
          <Link href="/proof">Proof</Link>
          <Link href="/install">Install</Link>
          <Link href="/onboarding">Onboarding</Link>
        </div>
      </nav>

      <section className="pageHeader">
        <p className="eyebrow">Public download trigger</p>
        <h1>Resolve a shared Immich link and record the licensed download.</h1>
        <p>
          Open this page with `?key=&lt;shared-link-key&gt;`. Aperture resolves
          the shared link locally, then sends the archive download through
          Tollgate&apos;s `/immich/api` proxy so nginx emits the billable access
          log line.
        </p>
      </section>

      <section className="surface wide">
        {key && sharedLink ? (
          <>
            <div className="sectionTitle inlineTitle">
              <h2>{sharedLink.assets.length} assets ready</h2>
              <span>{sharedLink.id}</span>
            </div>
            <div className="rows">
              {sharedLink.assets.map((asset) => (
                <div className="row ownerRow" key={asset.id}>
                  <div>
                    <strong>{asset.originalFileName}</strong>
                    <small>{asset.ownerId}</small>
                  </div>
                  <small>{asset.id}</small>
                </div>
              ))}
            </div>
            <DownloadArchiveButton assetIds={assetIds} sharedLinkKey={key} />
          </>
        ) : (
          <div className="empty">
            {key
              ? "Shared link could not be resolved."
              : "No shared-link key supplied."}
          </div>
        )}
      </section>
    </main>
  );
}
