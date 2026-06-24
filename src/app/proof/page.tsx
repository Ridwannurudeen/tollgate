import Link from "next/link";
import { ARC_EXPLORER_URL } from "../../lib/chain";
import {
  readLicenseLedger,
  summarizeLedger,
  verifyLicenseLedger,
} from "../../lib/ledger";
import { readWalletRegistry } from "../../lib/registry";

function formatUsdc(value: number) {
  return (value / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 6,
    maximumFractionDigits: 6,
  });
}

function txUrl(tx?: string) {
  return tx ? `${ARC_EXPLORER_URL}/tx/${tx}` : null;
}

export default async function ProofPage() {
  const [ledger, registry] = await Promise.all([
    readLicenseLedger(),
    readWalletRegistry(),
  ]);
  const verification = verifyLicenseLedger(ledger);
  const creators = summarizeLedger(ledger);
  const latest = ledger.receipts.at(-1);

  return (
    <main className="shell compact">
      <nav className="topbar">
        <Link className="brand" href="/">
          Aperture
        </Link>
        <div className="navlinks">
          <Link href="/">Home</Link>
          <a href={ARC_EXPLORER_URL}>Arcscan</a>
        </div>
      </nav>

      <section className="proofHeader">
        <div>
          <p className="eyebrow">Proof ledger</p>
          <h1>Every licensed download has a receipt.</h1>
        </div>
        <div className={verification.ok ? "status ok" : "status bad"}>
          {verification.ok ? "hash chain valid" : "hash chain issue"}
        </div>
      </section>

      <section className="statStrip">
        <div>
          <span>{ledger.receipts.length}</span>
          <small>receipts</small>
        </div>
        <div>
          <span>{registry.photographers.length}</span>
          <small>registered owners</small>
        </div>
        <div>
          <span>{verification.latestHash.slice(0, 12)}</span>
          <small>latest hash</small>
        </div>
      </section>

      <section className="tableSurface">
        <div className="sectionTitle">
          <h2>Photographer earnings</h2>
        </div>
        <div className="rows">
          {creators.length === 0 ? (
            <div className="empty">No licensed downloads recorded yet.</div>
          ) : (
            creators.map((creator) => (
              <div className="row" key={creator.wallet}>
                <div>
                  <strong>{creator.photographer}</strong>
                  <small>{creator.wallet}</small>
                </div>
                <div className="num">{creator.resolves}</div>
                <div className="num">{formatUsdc(creator.earned)} USDC</div>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="tableSurface">
        <div className="sectionTitle">
          <h2>Latest receipts</h2>
          {latest ? <span>{latest.receiptHash.slice(0, 18)}</span> : null}
        </div>
        <div className="rows">
          {ledger.receipts
            .slice()
            .reverse()
            .slice(0, 12)
            .map((receipt) => {
              const url = txUrl(receipt.transaction);
              return (
                <div className="row receiptRow" key={receipt.receiptHash}>
                  <div>
                    <strong>{receipt.photographer}</strong>
                    <small>{receipt.assetId}</small>
                  </div>
                  <div>
                    <span className="pill">{receipt.settlementMode}</span>
                  </div>
                  <div className="num">{formatUsdc(receipt.amountAtomicUsdc)}</div>
                  <div>
                    {url ? (
                      <a href={url}>tx</a>
                    ) : (
                      <span className="muted">local</span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      </section>
    </main>
  );
}
