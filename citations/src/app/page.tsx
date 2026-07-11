import { LandingPage } from "@/components/LandingPage";
import { SiteNav } from "@/components/SiteNav";
import { publicSource, readSources } from "@/lib/catalog";
import { buildProofPack } from "@/lib/proof-pack";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [proof, sources] = await Promise.all([buildProofPack(), readSources()]);

  return (
    <>
      <SiteNav proofOk={proof.integrity.ok} />
      <LandingPage proof={proof} sources={sources.map(publicSource)} />
    </>
  );
}
