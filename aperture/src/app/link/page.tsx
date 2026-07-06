import Link from "next/link";
import { LinkRegistrationForm } from "../../components/LinkRegistrationForm";

export const dynamic = "force-dynamic";

export default function LinkRegistrationPage() {
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";

  return (
    <main className="shell compact">
      <nav className="topbar">
        <Link className="brand" href="/">
          Aperture
        </Link>
        <div className="navlinks">
          <Link href="/browse">Browse</Link>
          <Link href="/dashboard">Dashboard</Link>
          <Link href="/proof">Proof</Link>
          <Link href="/install">Install</Link>
          <Link href="/onboarding">Onboarding</Link>
          <Link href="/login">Log in</Link>
        </div>
      </nav>

      <section className="pageHeader">
        <p className="eyebrow">Bring your own photo link</p>
        <h1>Gate a photo you already host.</h1>
        <p>
          Paste a public image URL, name the photographer, and share the
          Aperture link instead of the original. Buyers pay the license fee
          through x402; the image is streamed through Aperture after payment.
        </p>
      </section>

      <section className="twoColumn">
        <div className="surface">
          <h2>Create a gated link</h2>
          <p>
            The source image must be a public http(s) image under 25 MB. The
            original URL stays private; the share page shows only the title,
            photographer, and payment route.
          </p>
          <LinkRegistrationForm basePath={basePath} />
        </div>

        <div className="surface">
          <h2>What buyers see</h2>
          <div className="steps">
            <code>01 / open your Aperture share link</code>
            <code>02 / receive an x402 payment requirement</code>
            <code>03 / pay USDC on Arc</code>
            <code>04 / download the proxied image + receipt</code>
          </div>
        </div>
      </section>
    </main>
  );
}
