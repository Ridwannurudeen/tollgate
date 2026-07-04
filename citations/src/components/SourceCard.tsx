import Link from "next/link";
import { formatDollars, shortWallet } from "@/lib/format";
import type { CreatorSource } from "@/lib/types";

type Props = {
  source: CreatorSource;
  actionLabel?: string;
};

function sourceKindLabel(source: CreatorSource): string {
  if (source.sourceKind === "seed") return "Seed/demo content";
  if (source.sourceKind === "internal-test") return "Internal test content";
  if (source.verifiedCreator) return "Verified creator";
  return "Probationary source";
}

function originLabel(source: CreatorSource): string | null {
  if (source.origin === "discovered") return "Discovered";
  if (source.origin === "rss-import") return "RSS import";
  if (source.sourceKind === "external") return "Self-registered";
  return null;
}

export function SourceCard({ source, actionLabel = "Open source" }: Props) {
  const origin = originLabel(source);

  return (
    <article className="source-card source-catalog-card">
      <div className="source-card-main">
        <div className="source-badge-row">
          <span className="source-badge">{sourceKindLabel(source)}</span>
          {origin && <span className="source-badge muted">{origin}</span>}
        </div>
        <Link className="source-card-title" href={`/sources/${source.id}`}>
          {source.title}
        </Link>
        <span>
          {source.creator} / {source.handle} / {shortWallet(source.wallet)}
        </span>
        <div className="tag-list">
          {source.tags.slice(0, 4).map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </div>
      <div className="source-action">
        <strong>{formatDollars(source.priceAtomicUsdc)}</strong>
        <Link className="receipt-link" href={`/sources/${source.id}`}>
          {actionLabel}
        </Link>
      </div>
    </article>
  );
}
