import Link from "next/link";
import { formatDollars, shortWallet } from "@/lib/format";
import { sourceStatusBadgeClassName } from "@/lib/source-status";
import type { CreatorEarnings, CreatorSource } from "@/lib/types";

type Props = {
  creators: CreatorEarnings[];
  sources?: CreatorSource[];
  limit?: number;
  eyebrow?: string;
  heading?: string;
};

type CreatorDisplay = CreatorEarnings & {
  displaySourceKind?: CreatorSource["sourceKind"];
  displayCreatorKind?: CreatorSource["creatorKind"];
  displayVerifiedCreator?: boolean;
  displayCreatorClaimed?: boolean;
};

function withSourceProfile(
  creator: CreatorEarnings,
  sources: CreatorSource[],
): CreatorDisplay {
  const ownedSources = sources.filter(
    (source) => source.wallet.toLowerCase() === creator.wallet.toLowerCase(),
  );
  const external = ownedSources.find(
    (source) => source.sourceKind === "external",
  );
  const primary = external ?? ownedSources[0];
  return {
    ...creator,
    displaySourceKind: creator.sourceKind ?? primary?.sourceKind,
    displayCreatorKind: creator.creatorKind ?? primary?.creatorKind,
    displayVerifiedCreator:
      creator.verifiedCreator === true ||
      ownedSources.some((source) => source.verifiedCreator),
    displayCreatorClaimed:
      creator.creatorClaimed === true ||
      ownedSources.some((source) => source.creatorClaimed),
  };
}

function creatorRank(creator: CreatorDisplay): number {
  if (
    creator.displaySourceKind === "external" ||
    creator.displayCreatorKind === "external"
  ) {
    return 0;
  }
  if (
    creator.displaySourceKind === "seed" ||
    creator.displayCreatorKind === "seed"
  ) {
    return 1;
  }
  if (
    creator.displaySourceKind === "internal-test" ||
    creator.displayCreatorKind === "internal-test"
  ) {
    return 2;
  }
  return 3;
}

function creatorBadge(
  creator: CreatorDisplay,
): { label: string; className: string; title: string } | null {
  if (
    creator.displaySourceKind === "seed" ||
    creator.displayCreatorKind === "seed"
  ) {
    return {
      label: "Seed/demo",
      className: "source-badge muted",
      title: "Seed demo content used for public proof flows.",
    };
  }
  if (
    creator.displaySourceKind === "internal-test" ||
    creator.displayCreatorKind === "internal-test"
  ) {
    return {
      label: "Internal test",
      className: "source-badge muted",
      title: "Internal test content, not a public creator claim.",
    };
  }
  if (creator.displayVerifiedCreator) {
    return {
      label: "Verified",
      className: "source-badge",
      title: "Domain ownership was independently verified.",
    };
  }
  if (creator.displayCreatorClaimed) {
    return {
      label: "Creator-claimed",
      className: sourceStatusBadgeClassName({
        label: "Creator-claimed",
        detail: "Self-attested by the registrant, not independently verified.",
        tone: "claimed",
      }),
      title: "Self-attested by the registrant, not independently verified.",
    };
  }
  if (
    creator.displaySourceKind === "external" ||
    creator.displayCreatorKind === "external"
  ) {
    return {
      label: "External",
      className: "source-badge muted",
      title: "External creator source.",
    };
  }
  return null;
}

export function EarningsBoard({
  creators,
  sources = [],
  limit,
  eyebrow = "creator earnings",
  heading = "Who got paid",
}: Props) {
  const sortedCreators = creators
    .map((creator) => withSourceProfile(creator, sources))
    .slice()
    .sort(
      (a, b) =>
        creatorRank(a) - creatorRank(b) ||
        b.earnedAtomicUsdc - a.earnedAtomicUsdc,
    );
  const displayedCreators = limit
    ? sortedCreators.slice(0, limit)
    : sortedCreators;

  return (
    <div className="creator-table">
      <div className="panel-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h3>{heading}</h3>
      </div>
      {displayedCreators.length > 0 ? (
        displayedCreators.map((creator) => {
          const badge = creatorBadge(creator);
          return (
            <div className="creator-row" key={creator.wallet}>
              {badge && (
                <span className={badge.className} title={badge.title}>
                  {badge.label}
                </span>
              )}
              <span className="creator-chip" aria-hidden="true">
                {creator.creator
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((word) => word[0])
                  .join("")
                  .toUpperCase()}
              </span>
              <div className="creator-meta">
                <strong>{creator.creator}</strong>
                <span>
                  {creator.handle} / {shortWallet(creator.wallet)}
                </span>
              </div>
              <div className="numeric-cell">
                <strong className="num">
                  {formatDollars(creator.earnedAtomicUsdc)}
                </strong>
                <Link
                  className="receipt-link"
                  href={`/creators/${creator.wallet}`}
                >
                  {creator.citationCount} citations
                </Link>
              </div>
            </div>
          );
        })
      ) : (
        <div className="empty-state compact">
          <strong>No creators paid yet.</strong>
          <span>Run the first query to populate the earnings board.</span>
        </div>
      )}
    </div>
  );
}
