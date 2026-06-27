import { LeptonWebApp } from "@/components/LeptonWebApp";
import { readSources } from "@/lib/catalog";
import { readLedger, summarizeCreators } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ledger = await readLedger();
  const creators = summarizeCreators(ledger);
  const sources = await readSources();

  return (
    <LeptonWebApp
      initialCreators={creators}
      initialLedger={ledger}
      sources={sources}
    />
  );
}
