import type { CreatorSource } from "./types";

type SourceStatusInput = {
  sourceKind?: CreatorSource["sourceKind"];
  creatorKind?: CreatorSource["creatorKind"];
  verifiedCreator?: boolean;
  creatorClaimed?: boolean;
};

export type SourceStatusTone = "verified" | "claimed" | "muted";

export type SourceStatus = {
  label: string;
  detail: string;
  tone: SourceStatusTone;
};

export function sourceStatus(source: SourceStatusInput): SourceStatus {
  if (source.sourceKind === "seed" || source.creatorKind === "seed") {
    return {
      label: "Seed/demo content",
      detail: "Seed demo content used for public proof flows.",
      tone: "muted",
    };
  }
  if (
    source.sourceKind === "internal-test" ||
    source.creatorKind === "internal-test"
  ) {
    return {
      label: "Internal test content",
      detail: "Internal test content, not a public creator claim.",
      tone: "muted",
    };
  }
  if (source.verifiedCreator) {
    return {
      label: "Verified",
      detail: "Domain ownership was independently verified.",
      tone: "verified",
    };
  }
  if (source.creatorClaimed) {
    return {
      label: "Creator-claimed",
      detail: "Self-attested by the registrant, not independently verified.",
      tone: "claimed",
    };
  }
  return {
    label: "Unverified",
    detail: "Ownership is not verified; payouts remain escrow-held.",
    tone: "muted",
  };
}

export function sourceStatusBadgeClassName(status: SourceStatus): string {
  if (status.tone === "claimed") return "source-badge claimed";
  if (status.tone === "verified") return "source-badge";
  return "source-badge muted";
}
