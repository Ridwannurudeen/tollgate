import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AddEmailForm } from "../../components/AddEmailForm";
import { CopyButton } from "../../components/DashboardActions";
import { LinkedWalletsForm } from "../../components/LinkedWalletsForm";
import { SiteFooter } from "../../components/SiteFooter";
import { SiteNav } from "../../components/SiteNav";
import { getSessionOwner, maskAccountEmail } from "../../lib/account";
import {
  fetchCitationsSummary,
  type CitationsSummary,
  type CitationsSummarySource,
} from "../../lib/citations-summary";
import { readLicenseLedger } from "../../lib/ledger";
import { publicLink, readLinksByOwner } from "../../lib/link-registry";

export const dynamic = "force-dynamic";

function formatUsdc(value: number) {
  return (value / 1_000_000).toLocaleString("en-US", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

function uniqueWallets(wallets: string[]): string[] {
  return Array.from(
    new Set(
      wallets
        .map((wallet) => wallet.toLowerCase())
        .filter((wallet) => /^0x[0-9a-f]{40}$/.test(wallet)),
    ),
  );
}

function aggregateCitations(summaries: CitationsSummary[]) {
  const bySource = new Map<string, CitationsSummarySource>();
  for (const summary of summaries) {
    for (const source of summary.sources) {
      const current = bySource.get(source.id);
      if (!current) {
        bySource.set(source.id, source);
        continue;
      }
      bySource.set(source.id, {
        ...current,
        citationCount: current.citationCount + source.citationCount,
        earnedAtomicUsdc: current.earnedAtomicUsdc + source.earnedAtomicUsdc,
      });
    }
  }
  return {
    sourceCount: summaries.reduce(
      (sum, summary) => sum + summary.earnings.sourceCount,
      0,
    ),
    citationCount: summaries.reduce(
      (sum, summary) => sum + summary.earnings.citationCount,
      0,
    ),
    earnedAtomicUsdc: summaries.reduce(
      (sum, summary) => sum + summary.earnings.earnedAtomicUsdc,
      0,
    ),
    sources: Array.from(bySource.values()).sort(
      (a, b) => b.earnedAtomicUsdc - a.earnedAtomicUsdc,
    ),
  };
}

export default async function DashboardPage() {
  const owner = await getSessionOwner();
  if (!owner) redirect("/login");
  const basePath = process.env.APERTURE_BASE_PATH ?? "/aperture";
  const configuredCitationsBaseUrl =
    process.env.CITATIONS_BASE_URL?.trim().replace(/\/+$/, "");
  const citationsBaseUrl =
    configuredCitationsBaseUrl || "https://tollgate.gudman.xyz";
  const trackedWallets = uniqueWallets([
    owner.wallet,
    ...(owner.linkedWallets ?? []),
  ]);
  const [rawWorks, ledger, citationResults] = await Promise.all([
    readLinksByOwner(owner.ownerId),
    readLicenseLedger(),
    Promise.all(trackedWallets.map((wallet) => fetchCitationsSummary(wallet))),
  ]);
  const works = rawWorks.map(publicLink);
  const receipts = ledger.receipts.filter(
    (receipt) => receipt.ownerId === owner.ownerId,
  );
  const photoEarned = receipts.reduce(
    (sum, receipt) => sum + receipt.amountAtomicUsdc,
    0,
  );
  const citationSummaries = citationResults.filter(
    (summary): summary is CitationsSummary => summary !== null,
  );
  const citationsUnavailable = citationResults.some(
    (summary) => summary === null,
  );
  const citations = aggregateCitations(citationSummaries);
  const totalEarned = photoEarned + citations.earnedAtomicUsdc;

  return (
    <>
      <main className="shell compact">
        <SiteNav />

        <section className="proofHeader">
          <div>
            <p className="eyebrow">Tollgate creator account</p>
            <h1>Your Tollgate creator dashboard</h1>
            <p className="lede dashboardLede">
              {owner.displayName} can track Aperture photo licenses, Citations
              cite-to-earn receipts, and the video proof rail from one login.
            </p>
          </div>
        </section>

        <section className="statStrip">
          <div>
            <span>{works.length}</span>
            <small>Aperture photos</small>
          </div>
          <div>
            <span>{receipts.length}</span>
            <small>licensed downloads</small>
          </div>
          <div>
            <span>{formatUsdc(citations.earnedAtomicUsdc)}</span>
            <small>Citations USDC earned</small>
          </div>
          <div>
            <span>{formatUsdc(totalEarned)}</span>
            <small>Photos + Citations USDC</small>
          </div>
          <div>
            <span>{trackedWallets.length}</span>
            <small>tracked wallets</small>
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
            <div>
              <small>Login email</small>
              {owner.email ? (
                <strong>{maskAccountEmail(owner.email)}</strong>
              ) : (
                <AddEmailForm basePath={basePath} />
              )}
            </div>
          </div>
        </section>

        <section className="tableSurface">
          <div className="sectionTitle">
            <h2>Photos (Aperture)</h2>
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

        <section className="tableSurface">
          <div className="sectionTitle">
            <h2>Citations (cite-to-earn)</h2>
            <span>{trackedWallets.length} wallet(s) tracked</span>
          </div>
          <div className="statStrip embeddedStrip">
            <div>
              <span>{citations.sourceCount}</span>
              <small>sources cited</small>
            </div>
            <div>
              <span>{citations.citationCount}</span>
              <small>paid citations</small>
            </div>
            <div>
              <span>{formatUsdc(citations.earnedAtomicUsdc)}</span>
              <small>USDC earned</small>
            </div>
          </div>
          {citationsUnavailable ? (
            <div className="empty">
              Couldn&apos;t load citations earnings right now. Aperture photos
              are still available.
            </div>
          ) : citations.sources.length === 0 ? (
            <div className="empty">
              Register sources at tollgate.gudman.xyz, or add the wallet you use
              there below.
            </div>
          ) : (
            <div className="citationSourceList">
              {citations.sources.map((source) => (
                <article className="row citationSourceRow" key={source.id}>
                  <div>
                    <strong>{source.title}</strong>
                    <small>
                      {source.creator} / {source.wallet}
                    </small>
                  </div>
                  <div className="num">{source.citationCount} citations</div>
                  <div className="num">
                    {formatUsdc(source.earnedAtomicUsdc)} USDC
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="linkedWalletPanel">
            <div>
              <p className="eyebrow">linked wallets</p>
              <h3>Wallets you&apos;re tracking</h3>
              <p>
                These links only change what this dashboard reads. Citation
                payouts still go to the original wallet on-chain.
              </p>
            </div>
            <LinkedWalletsForm
              basePath={basePath}
              linkedWallets={owner.linkedWallets ?? []}
            />
          </div>
        </section>

        <section className="surface videoProofCard">
          <div>
            <p className="eyebrow">video rail</p>
            <h2>Video payouts settle through the PeerTube plugin.</h2>
            <p>
              Video does not expose per-wallet earnings in the Citations ledger.
              The proof page shows the shared on-chain FeeRouter routing
              evidence instead of inventing a creator total.
            </p>
          </div>
          <a className="button primary" href={`${citationsBaseUrl}/video`}>
            Open video proof
          </a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
