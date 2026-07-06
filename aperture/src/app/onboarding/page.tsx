import Link from "next/link";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import { readWalletRegistry } from "../../lib/registry";
import { RegisterCreatorForm } from "../../components/RegisterCreatorForm";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const registry = await readWalletRegistry();
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";

  return (
    <>
      <main className="shell compact">
        <SiteNav />

      <section className="pageHeader">
        <p className="eyebrow">Photographer onboarding</p>
        <h1>Map each Immich owner to a payout wallet.</h1>
        <p>
          Aperture pays the uploader first because Immich v2.7.5 does not expose
          EXIF Artist or Copyright through its API. When filesystem EXIF is
          enabled, receipts can also show the embedded credit.
        </p>
        <p>
          Already host your photos elsewhere?{" "}
          <Link href="/link">Paste a photo URL instead</Link> and share an
          Aperture payment-gated link.
        </p>
      </section>

      <section className="flow" aria-label="How photographers get paid">
        {[
          [
            "01",
            "Get an Immich account",
            "Join this community's photo server and upload your photos there. Aperture is the payment sidecar; Immich hosts the files.",
          ],
          [
            "02",
            "Share your work",
            "Create Immich shared links the same way you do today.",
          ],
          [
            "03",
            "Register below",
            "Add your Immich owner ID and payout wallet, or leave wallet blank and we create a Circle W3S custodial wallet for you.",
          ],
          [
            "04",
            "Get paid per license",
            "Every licensed download pays USDC on Arc through the FeeRouter, with a verifiable receipt.",
          ],
        ].map(([step, title, body]) => (
          <div className="flowCard" key={step}>
            <span>{step}</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </div>
        ))}
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
      <SiteFooter />
    </>
  );
}
