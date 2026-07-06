import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkDownloadButton } from "../../../components/LinkDownloadButton";
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

  return (
    <main className="shell compact">
      <nav className="topbar">
        <Link className="brand" href="/">
          Aperture
        </Link>
        <div className="navlinks">
          <Link href="/link">Create link</Link>
          <Link href="/proof">Proof</Link>
          <Link href="/onboarding">Onboarding</Link>
        </div>
      </nav>

      <section className="pageHeader">
        <p className="eyebrow">Aperture gated photo</p>
        <h1>{link.title}</h1>
        <p>
          Photo by {photographer.displayName}. Unlock this photo for{" "}
          {formatUsdc(price)} digital dollars (USDC); the photographer is paid
          instantly and the download receipt lands in the proof ledger.
        </p>
      </section>

      <section className="surface wide">
        <div className="sectionTitle inlineTitle">
          <h2>License download</h2>
          <span>{link.id}</span>
        </div>
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
  );
}
