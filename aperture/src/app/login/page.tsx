import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import { LoginForm } from "../../components/LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";

  return (
    <>
      <main className="shell compact">
        <SiteNav />

      <section className="pageHeader">
        <p className="eyebrow">Creator account</p>
        <h1>Log in with a private email link.</h1>
        <p>
          Enter the email you added during registration. Aperture sends a
          single-use link that opens your creator dashboard, no wallet signature
          or browser wallet required.
        </p>
      </section>

      <section className="surface accountSurface">
        <h2>Email login</h2>
        <p>
          The response is private: it looks the same whether or not the email is
          registered.
        </p>
        <LoginForm basePath={basePath} />
      </section>
      </main>
      <SiteFooter />
    </>
  );
}
