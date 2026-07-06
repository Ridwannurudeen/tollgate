import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CopyButton, LogoutButton } from "../../components/DashboardActions";
import { getSessionOwner } from "../../lib/account";
import { readLicenseLedger } from "../../lib/ledger";
import { publicLink, readLinksByOwner } from "../../lib/link-registry";

export const dynamic = "force-dynamic";

function formatUsdc(value: number) {
  return (value / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

export default async function DashboardPage() {
  const owner = await getSessionOwner();
  if (!owner) redirect("/login");
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";
  const [rawWorks, ledger] = await Promise.all([
    readLinksByOwner(owner.ownerId),
    readLicenseLedger(),
  ]);
  const works = rawWorks.map(publicLink);
  const receipts = ledger.receipts.filter(
    (receipt) => receipt.ownerId === owner.ownerId,
  );
  const totalEarned = receipts.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );

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
          <Link href="/login">Log in</Link>
        </div>
      </nav>

      <section className="proofHeader">
        <div>
          <p className="eyebrow">Creator dashboard</p>
          <h1>{owner.displayName}</h1>
        </div>
        <LogoutButton basePath={basePath} />
      </section>

      <section className="statStrip">
        <div>
          <span>{works.length}</span>
          <small>registered works</small>
        </div>
        <div>
          <span>{receipts.length}</span>
          <small>licensed downloads</small>
        </div>
        <div>
          <span>{formatUsdc(totalEarned)}</span>
          <small>USDC routed</small>
        </div>
        <div>
          <span>{owner.approvalStatus}</span>
          <small>account status</small>
        </div>
      </section>

      <section className="surface">
        <div className="sectionTitle inlineTitle">
          <h2>Account</h2>
          <span>{owner.ownerId}</span>
        </div>
        <div className="accountGrid">
          <div>
            <small>Display name</small>
            <strong>{owner.displayName}</strong>
          </div>
          <div>
            <small>
              {owner.custody === "circle-w3s"
                ? "Wallet we created for you"
                : "Your wallet"}
            </small>
            <strong>{owner.wallet}</strong>
          </div>
          <div>
            <small>Custody</small>
            <strong>{owner.custody ?? "self"}</strong>
          </div>
        </div>
      </section>

      <section className="tableSurface">
        <div className="sectionTitle">
          <h2>Your works</h2>
          <Link href="/link">Register another</Link>
        </div>
        <div className="workGrid">
          {works.length === 0 ? (
            <div className="empty">No works registered yet.</div>
          ) : (
            works.map((work) => {
              const sharePath = `${basePath}/link/${work.id}`;
              return (
                <article className="workCard" key={work.id}>
                  {work.hasPreview ? (
                    <img
                      alt={`Watermarked preview of ${work.title}`}
                      src={`${basePath}/link/${work.id}/preview`}
                    />
                  ) : (
                    <div className="previewPlaceholder">Preview pending</div>
                  )}
                  <div>
                    <h3>{work.title}</h3>
                    <small>
                      {work.hasPreview ? "preview ready" : "no preview"}
                    </small>
                  </div>
                  <div className="workMeta">
                    <span>{formatUsdc(work.priceAtomicUsdc)} USDC</span>
                    <Link href={`/link/${work.id}`}>Open</Link>
                  </div>
                  <div className="shareRow">
                    <input readOnly value={sharePath} />
                    <CopyButton value={sharePath}>Copy URL</CopyButton>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}
