import Link from "next/link";
import { formatDollars, shortWallet } from "@/lib/format";
import type { CreatorEarnings } from "@/lib/types";

type Props = {
  creators: CreatorEarnings[];
  limit?: number;
  eyebrow?: string;
  heading?: string;
};

export function EarningsBoard({
  creators,
  limit,
  eyebrow = "creator earnings",
  heading = "Who got paid",
}: Props) {
  const displayedCreators = limit ? creators.slice(0, limit) : creators;

  return (
    <div className="creator-table">
      <div className="panel-heading">
        <p className="eyebrow">{eyebrow}</p>
        <h3>{heading}</h3>
      </div>
      {displayedCreators.length > 0 ? (
        displayedCreators.map((creator) => (
          <div className="creator-row" key={creator.wallet}>
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
        ))
      ) : (
        <div className="empty-state compact">
          <strong>No creators paid yet.</strong>
          <span>Run the first query to populate the earnings board.</span>
        </div>
      )}
    </div>
  );
}
