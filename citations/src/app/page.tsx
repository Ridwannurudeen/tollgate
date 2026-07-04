import { LandingPage } from "@/components/LandingPage";
import { SiteNav } from "@/components/SiteNav";
import { publicSource, readSources } from "@/lib/catalog";
import {
  readLedger,
  summarizeCreators,
  verifyLedgerIntegrity,
} from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ledger = await readLedger();
  const creators = summarizeCreators(ledger);
  const sources = await readSources();
  const verification = verifyLedgerIntegrity(ledger);

  return (
    <>
      <SiteNav proofOk={verification.ok} />
      <LandingPage
        creators={creators}
        ledger={ledger}
        sources={sources.map(publicSource)}
      />
    </>
  );
}
