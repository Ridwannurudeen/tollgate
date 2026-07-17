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

  it("parses the Tollgate-mounted Immich archive download trigger", () => {
    const event = parseDownloadArchiveAccessLog(
      '127.0.0.1 - - [24/Jun/2026:07:45:36 +0200] "POST /immich/api/download/archive?key=abc123 HTTP/2.0" 200 150 "-" "curl/8.5.0"',
    );
    expect(event).toMatchObject({
      path: "/api/download/archive",
      sharedLinkKey: "abc123",
      status: 200,
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
      type: "INDIVIDUAL",
      allowDownload: true,
      assets: [
        {
          id: "asset-1",
          ownerId: "owner-1",
          originalFileName: "photo.png",
          originalPath: "/opt/immich/library/photo.png",
        },
      ],
    });

    expect(parsed).toMatchObject({
      type: "INDIVIDUAL",
      allowDownload: true,
    });
    expect(parsed.assets[0]).toEqual({
      id: "asset-1",
      ownerId: "owner-1",
      originalFileName: "photo.png",
      originalPath: "/opt/immich/library/photo.png",
    });
  });

  it("requires Immich's allowDownload flag", () => {
    expect(() =>
      parseSharedLink({
        id: "share-1",
        key: "abc",
        type: "INDIVIDUAL",
        assets: [],
      }),
    ).toThrow("Immich shared link allowDownload missing.");
  });

  it("rejects shared links whose downloads are disabled", () => {
    expect(() =>
      parseSharedLink({
        id: "share-1",
        key: "abc",
        type: "INDIVIDUAL",
        allowDownload: false,
        assets: [],
      }),
    ).toThrow("Immich shared link does not allow downloads.");
  });

  it("rejects non-individual shared links", () => {
    expect(() =>
      parseSharedLink({
        id: "share-1",
        key: "abc",
        type: "ALBUM",
        allowDownload: true,
        assets: [],
      }),
    ).toThrow("Immich shared link is not an individual-asset link.");
  });

  it("rejects album-shaped shared-link responses", () => {
    expect(() =>
      parseSharedLink({
        id: "share-1",
        key: "abc",
        type: "INDIVIDUAL",
        allowDownload: true,
        album: { id: "album-1" },
        assets: [],
      }),
    ).toThrow("Immich shared link contains an album.");
  });
});
