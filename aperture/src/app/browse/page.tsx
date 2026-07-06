import React from "react";
import Link from "next/link";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import { listPublicLinks } from "../../lib/link-registry";
import { readWalletRegistry } from "../../lib/registry";

export const dynamic = "force-dynamic";

function formatUsdc(value: number) {
  return (value / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export default async function BrowsePage() {
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";
  const [links, registry] = await Promise.all([
    listPublicLinks(),
    readWalletRegistry(),
  ]);
  const owners = new Map(
    registry.photographers.map((entry) => [entry.ownerId, entry.displayName]),
  );

  return (
    <>
      <main className="shell">
        <SiteNav />

      <section className="pageHeader">
        <p className="eyebrow">Public catalog</p>
        <h1>Browse registered photo licenses.</h1>
        <p>
          Every work here has a gated Aperture page. Watermarked previews are
          public; the original image bytes stay behind the paid unlock.
        </p>
      </section>

      <section className="browseGrid" aria-label="Registered Aperture works">
        {links.length === 0 ? (
          <div className="empty catalogEmpty">
            No registered photo links yet.
          </div>
        ) : (
          links.map((link) => (
            <Link
              className="workCard browseCard"
              href={`/link/${link.id}`}
              key={link.id}
            >
              {link.hasPreview ? (
                <img
                  alt={`Watermarked preview of ${link.title}`}
                  src={`${basePath}/link/${link.id}/preview`}
                />
              ) : (
                <div className="previewPlaceholder">Preview pending</div>
              )}
              <div>
                <h2>{link.title}</h2>
                <p>{owners.get(link.ownerId) ?? "Registered photographer"}</p>
              </div>
              <div className="workMeta">
                <span>{formatUsdc(link.priceAtomicUsdc)} USDC</span>
                <small>Open gated page</small>
              </div>
            </Link>
          ))
        )}
      </section>
      </main>
      <SiteFooter />
    </>
  );
}
