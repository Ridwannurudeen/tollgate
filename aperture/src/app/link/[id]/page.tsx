import React from "react";
import { notFound } from "next/navigation";
import { LinkDownloadButton } from "../../../components/LinkDownloadButton";
import { SiteFooter } from "../../../components/SiteFooter";
import { SiteNav } from "../../../components/SiteNav";
import { APERTURE_LICENSE_FEE_ATOMIC_USDC } from "../../../lib/config";
import { findLink } from "../../../lib/link-registry";
import { readWalletForOwner } from "../../../lib/registry";

export const dynamic = "force-dynamic";

type LinkPageProps = {
  params: Promise<{ id: string }>;
};

function formatUsdc(value: number) {
  return (value / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export default async function GatedLinkPage({ params }: LinkPageProps) {
  const { id } = await params;
  const link = await findLink(id);
  if (!link) notFound();
  const photographer = await readWalletForOwner(link.ownerId);
  if (!photographer) notFound();
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";
  const price = link.priceAtomicUsdc || APERTURE_LICENSE_FEE_ATOMIC_USDC;
  const isVideo = link.mediaKind === "video";
  const mediaLabel = isVideo ? "video" : "photo";

  return (
    <>
      <main className="shell compact">
        <SiteNav />

        <section className="pageHeader">
          <p className="eyebrow">Aperture gated {mediaLabel}</p>
          <h1>{link.title}</h1>
          {link.description && (
            <p className="linkDescription">{link.description}</p>
          )}
          <p>
            {isVideo ? "Video" : "Photo"} by {photographer.displayName}. Unlock
            this {mediaLabel} for{" "}
            {formatUsdc(price)} digital dollars (USDC); the photographer is paid
            instantly and the download receipt lands in the proof ledger.
          </p>
        </section>

        <section className="surface wide">
          <div className="sectionTitle inlineTitle">
            <h2>License download</h2>
            <span>{link.id}</span>
          </div>
          {link.hasPreview && (
            <figure className="previewFrame">
              <div className="mediaPreview">
                <img
                  alt={`Watermarked preview of ${link.title}`}
                  src={`${basePath}/link/${link.id}/preview`}
                />
                {isVideo && <span className="mediaBadge">video</span>}
              </div>
              <figcaption>
                {isVideo
                  ? "Watermarked thumbnail preview - unlock to download the full video."
                  : "Watermarked preview - unlock to download the full-resolution original."}
              </figcaption>
            </figure>
          )}
          <p>
            The original host URL is not exposed on this page. Choose your own
            wallet, or use the no-wallet demo unlock funded by Tollgate.
          </p>
          <LinkDownloadButton
            basePath={basePath}
            id={link.id}
            priceText={`${formatUsdc(price)} USDC`}
            title={link.title}
          />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
