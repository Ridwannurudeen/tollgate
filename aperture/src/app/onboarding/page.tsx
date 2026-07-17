import Link from "next/link";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import {
  publicWalletRegistryEntry,
  readWalletRegistry,
} from "../../lib/registry";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const registry = await readWalletRegistry();

  return (
    <>
      <main className="shell compact">
        <SiteNav />

        <section className="pageHeader">
          <p className="eyebrow">Photographer onboarding</p>
          <h1>Map each Immich owner to a payout wallet.</h1>
          <p>
            Aperture pays only operator-verified Immich owner mappings. The
            payment gate records the payout before nginx accepts the
            short-lived archive authorization.
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
              "Verify with the operator",
              "The server operator confirms your Immich owner ID before creating its payout mapping.",
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
            <h2>Operator-assisted registration</h2>
            <p>
              Send the operator your Immich owner ID, display name, and payout
              wallet. The registration capability is server-held and never
              entered into this page. The operator verifies the Immich account
              before issuing the mapping.
            </p>
          </div>

          <div className="surface">
            <h2>Current registry</h2>
            <div className="rows compactRows">
              {registry.photographers.map((entry) => {
                const projected = publicWalletRegistryEntry(entry);
                return (
                  <div className="row ownerRow" key={entry.ownerId}>
                    <div>
                      <strong>{projected.displayName}</strong>
                      <small>{projected.ownerId}</small>
                      <small>{projected.approvalStatus}</small>
                    </div>
                    <small>{projected.wallet}</small>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
