import { LinkRegistrationForm } from "../../components/LinkRegistrationForm";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";

export const dynamic = "force-dynamic";

export default function LinkRegistrationPage() {
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";

  return (
    <>
      <main className="shell compact">
        <SiteNav />

        <section className="pageHeader">
          <p className="eyebrow">Sell a media license</p>
          <h1>Gate a photo, video, or hosted image.</h1>
          <p>
            Upload an original or paste a public image URL, name the
            photographer, and share the Aperture link instead of the source.
            Buyers pay the license fee through x402; the media is streamed
            through Aperture after payment.
          </p>
        </section>

        <section className="twoColumn">
          <div className="surface">
            <h2>Create a gated link</h2>
            <p>
              Uploaded originals are stored by Aperture; hosted image URLs stay
              private and are proxied after payment. Photos stay under 25 MB,
              videos stay under 100 MB, and buyers only see the watermarked
              preview before unlocking.
            </p>
            <LinkRegistrationForm basePath={basePath} />
          </div>

          <div className="surface">
            <h2>What buyers see</h2>
            <div className="steps">
              <code>01 / open your Aperture share link</code>
              <code>02 / receive an x402 payment requirement</code>
              <code>03 / pay USDC on Arc</code>
              <code>04 / download the proxied media + receipt</code>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
