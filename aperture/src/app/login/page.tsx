import Link from "next/link";
import { LoginForm } from "../../components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";

  return (
    <main className="shell compact">
      <nav className="topbar">
        <Link className="brand" href="/">
          Aperture
        </Link>
        <div className="navlinks">
          <Link href="/browse">Browse</Link>
          <Link href="/link">Create link</Link>
          <Link href="/proof">Proof</Link>
        </div>
      </nav>

      <section className="pageHeader">
        <p className="eyebrow">Creator account</p>
        <h1>Log in with your Aperture account key.</h1>
        <p>
          Paste the one-time key you received when you registered your first
          gated photo. No wallet signature, browser wallet, or email account is
          required.
        </p>
      </section>

      <section className="surface accountSurface">
        <h2>Account key</h2>
        <p>
          The plaintext key is shown only once during registration. Aperture
          stores only its hash and uses it to recover your creator dashboard.
        </p>
        <LoginForm basePath={basePath} />
      </section>
    </main>
  );
}
