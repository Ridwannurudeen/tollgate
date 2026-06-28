import Link from "next/link";
import { readWalletRegistry } from "../../lib/registry";
import { RegisterCreatorForm } from "../../components/RegisterCreatorForm";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const registry = await readWalletRegistry();
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";

  return (
    <main className="shell compact">
      <nav className="topbar">
        <Link className="brand" href="/">
          Aperture
        </Link>
        <div className="navlinks">
          <Link href="/proof">Proof</Link>
          <Link href="/install">Install</Link>
        </div>
      </nav>

      <section className="pageHeader">
        <p className="eyebrow">Photographer onboarding</p>
        <h1>Map each Immich owner to a payout wallet.</h1>
        <p>
          Aperture pays the uploader first because Immich v2.7.5 does not expose
          EXIF Artist or Copyright through its API. When filesystem EXIF is
          enabled, receipts can also show the embedded credit.
        </p>
      </section>

      <section className="twoColumn">
        <div className="surface">
          <h2>Register to get paid</h2>
          <p>
            Add your Immich owner ID and name. Leave the wallet blank and we
            create a Circle-custodied one for you. Self-custody mappings stay
            pending until the operator approves or verifies ownership.
          </p>
          <RegisterCreatorForm basePath={basePath} />
        </div>

        <div className="surface">
          <h2>Current registry</h2>
          <div className="rows compactRows">
            {registry.photographers.map((entry) => (
              <div className="row ownerRow" key={entry.ownerId}>
                <div>
                  <strong>{entry.displayName}</strong>
                  <small>{entry.ownerId}</small>
                  <small>{entry.approvalStatus}</small>
                </div>
                <small>{entry.wallet}</small>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
