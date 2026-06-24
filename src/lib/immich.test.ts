import { describe, expect, it } from "vitest";
import { parseDownloadArchiveAccessLog, parseSharedLink } from "./immich";

const LINE =
  '127.0.0.1 - - [24/Jun/2026:07:45:36 +0200] "POST /api/download/archive?key=abc123 HTTP/2.0" 200 150 "-" "curl/8.5.0"';

describe("parseDownloadArchiveAccessLog", () => {
  it("parses the verified Immich archive download trigger", () => {
    const event = parseDownloadArchiveAccessLog(LINE);
    expect(event).toMatchObject({
      remoteAddress: "127.0.0.1",
      method: "POST",
      path: "/api/download/archive",
      sharedLinkKey: "abc123",
      status: 200,
      userAgent: "curl/8.5.0",
    });
  });

  it("ignores thumbnail and download-info requests", () => {
    expect(
      parseDownloadArchiveAccessLog(
        '127.0.0.1 - - [24/Jun/2026:07:45:36 +0200] "GET /api/assets/a/thumbnail?key=abc123 HTTP/2.0" 200 150 "-" "ua"',
      ),
    ).toBeNull();
    expect(
      parseDownloadArchiveAccessLog(
        '127.0.0.1 - - [24/Jun/2026:07:45:36 +0200] "POST /api/download/info?key=abc123 HTTP/2.0" 201 150 "-" "ua"',
      ),
    ).toBeNull();
  });
});

describe("parseSharedLink", () => {
  it("extracts assets and owners from Immich shared-link JSON", () => {
    const parsed = parseSharedLink({
      id: "share-1",
      key: "abc",
      assets: [
        {
          id: "asset-1",
          ownerId: "owner-1",
          originalFileName: "photo.png",
        },
      ],
    });

    expect(parsed.assets[0]).toEqual({
      id: "asset-1",
      ownerId: "owner-1",
      originalFileName: "photo.png",
    });
  });
});
