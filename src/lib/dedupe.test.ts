import { describe, expect, it } from "vitest";
import { buildResolveEventId, resolveWindowBucket } from "./dedupe";
import type { DownloadArchiveEvent } from "./types";

const event: DownloadArchiveEvent = {
  remoteAddress: "127.0.0.1",
  method: "POST",
  path: "/api/download/archive",
  sharedLinkKey: "share-key",
  status: 200,
  userAgent: "browser",
  referer: null,
  createdAt: "2026-06-24T05:45:36.000Z",
  rawLine: "raw",
};

describe("dedupe", () => {
  it("buckets resolves into ten minute windows", () => {
    expect(resolveWindowBucket("2026-06-24T05:45:36.000Z")).toBe(
      "2026-06-24T05:40:00.000Z",
    );
  });

  it("builds stable event ids for the same viewer window", () => {
    expect(buildResolveEventId(event, "share-1", "asset-1")).toBe(
      buildResolveEventId({ ...event, rawLine: "different" }, "share-1", "asset-1"),
    );
  });
});
