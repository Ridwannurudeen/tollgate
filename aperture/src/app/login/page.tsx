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
          <h1>Sign in or create your Aperture account.</h1>
          <p>
            Enter your email. Aperture sends a private link that signs you in,
            or creates your creator account if you&apos;re new.
          </p>
        </section>

        <section className="surface accountSurface">
          <h2>Email link</h2>
          <p>
            The response is private: it looks the same for new and existing
            emails.
          </p>
          <LoginForm basePath={basePath} />
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
