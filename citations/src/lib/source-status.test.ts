import { describe, expect, it } from "vitest";
import { sourceStatus, sourceStatusBadgeClassName } from "./source-status";

describe("sourceStatus", () => {
  it("keeps creator-claimed distinct from verified", () => {
    const claimed = sourceStatus({
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: false,
      creatorClaimed: true,
    });
    const verified = sourceStatus({
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: true,
      creatorClaimed: true,
    });

    expect(claimed.label).toBe("Creator-claimed");
    expect(claimed.detail).toMatch(/not independently verified/i);
    expect(sourceStatusBadgeClassName(claimed)).toBe("source-badge claimed");
    expect(verified.label).toBe("Verified");
    expect(sourceStatusBadgeClassName(verified)).toBe("source-badge");
  });

  it("labels unverified external work without verified styling", () => {
    const status = sourceStatus({
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: false,
    });

    expect(status.label).toBe("Unverified");
    expect(sourceStatusBadgeClassName(status)).toBe("source-badge muted");
  });
});
