import { describe, expect, it } from "vitest";
import { projectPublicData, publicLicenseLedger } from "./public-data";
import type { LicenseLedger } from "./types";

describe("Aperture public data projections", () => {
  it("removes host paths and redacts PII without changing stored receipt hashes", () => {
    const receiptHash = `0x${"4".repeat(64)}` as `0x${string}`;
    const ledger = {
      receipts: [
        {
          id: "receipt-1",
          eventId: `0x${"1".repeat(64)}`,
          assetId: "asset-1",
          sharedLinkId: "link-1",
          sharedLinkKeyHash: `0x${"2".repeat(64)}`,
          ownerId: "owner-1",
          photographer: "archive@example.com",
          wallet: "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
          amountAtomicUsdc: 2500,
          settlementMode: "local-proof",
          paymentResource: "http://127.0.0.1:2283/api/assets/private",
          exifArtist: "archive@example.com",
          exifCopyright: "Copyright archive@example.com",
          exifSourcePath: "C:\\Immich\\library\\private\\photo.jpg",
          rawAccessLogHash: `0x${"3".repeat(64)}`,
          previousHash: `0x${"0".repeat(64)}`,
          receiptHash,
          createdAt: "2026-07-06T00:00:00.000Z",
        },
      ],
    } satisfies LicenseLedger;

    const projected = publicLicenseLedger(ledger);
    const payload = JSON.stringify(projected);

    expect(payload).not.toContain("archive@example.com");
    expect(payload).not.toContain("127.0.0.1");
    expect(payload).not.toContain("C:\\\\Immich\\\\library");
    expect(projected.receipts[0]).not.toHaveProperty("exifSourcePath");
    expect(projected.receipts[0].receiptHash).toBe(receiptHash);
    expect(ledger.receipts[0].exifSourcePath).toBe(
      "C:\\Immich\\library\\private\\photo.jpg",
    );
  });

  it("keeps public URLs while removing private URL fields and literals", () => {
    const projected = projectPublicData({
      publicUrl: "https://example.com/proof",
      privateUrl: "http://[::1]:2283/private",
      detail:
        "Internal evidence http://192.168.1.2/path and http://127.0.0.1:2283.",
    });

    expect(projected.publicUrl).toBe("https://example.com/proof");
    expect(projected.privateUrl).toBe("[redacted-private-url]");
    expect(projected.detail).not.toContain("192.168.1.2");
    expect(projected.detail).not.toContain("127.0.0.1");
  });

  it("redacts all bare IP addresses and host paths without hiding routes", () => {
    const projected = projectPublicData({
      detail:
        "Hosts 10.23.4.5, fd12:3456::9, and ::ffff:127.0.0.1 wrote C:\\Immich\\library\\private\\photo.jpg and /var/lib/immich/private/photo.jpg.",
      publicAddresses: "Resolvers 8.8.8.8 and 2606:4700:4700::1111.",
      publicFileUrl: "https://example.com/var/lib/public-proof.json",
      publicIpv4Url: "https://8.8.8.8/proof",
      publicIpv6Url: "https://[2606:4700:4700::1111]/proof",
      publicUrlWithPrivateQuery: "https://example.com/proof?upstream=10.91.2.3",
      publicUrlWithPublicQuery: "https://example.com/proof?resolver=8.8.8.8",
      routePath: "/api/proof/receipts",
      sourcePath: "/srv/tollgate/private.json",
    });
    const payload = JSON.stringify(projected);

    expect(payload).not.toContain("10.23.4.5");
    expect(payload).not.toContain("fd12:3456::9");
    expect(payload).not.toContain("::ffff:127.0.0.1");
    expect(payload).not.toContain("C:\\\\Immich\\\\library");
    expect(payload).not.toContain("/var/lib/immich");
    expect(projected).not.toHaveProperty("sourcePath");
    expect(projected.publicAddresses).not.toContain("8.8.8.8");
    expect(projected.publicAddresses).not.toContain("2606:4700:4700::1111");
    expect(projected.publicFileUrl).toBe(
      "https://example.com/var/lib/public-proof.json",
    );
    expect(projected.publicIpv4Url).not.toContain("8.8.8.8");
    expect(projected.publicIpv6Url).not.toContain("2606:4700:4700::1111");
    expect(projected.publicUrlWithPrivateQuery).toBe(
      "https://example.com/proof?upstream=[redacted-private-ip]",
    );
    expect(projected.publicUrlWithPublicQuery).toBe(
      "https://example.com/proof?resolver=[redacted-private-ip]",
    );
    expect(projected.routePath).toBe("/api/proof/receipts");
  });

  it("redacts assignment-delimited host paths and alternate loopback forms", () => {
    const projected = projectPublicData({
      windowsPath: "path=C:\\Immich\\library\\private\\photo.jpg",
      posixPath: "path=/var/lib/immich/private/photo.jpg",
      uncPath: "path=\\\\fileserver\\private\\photo.jpg",
      alternateLoopbacks:
        "Hosts 0177.0.0.1, 0x7f000001, 2130706433, and 127.1.",
      routePath: "/api/proof/receipts",
      publicFileUrl: "https://example.com/var/lib/public-proof.json",
    });
    const payload = JSON.stringify(projected);

    expect(payload).not.toContain("C:\\\\Immich\\\\library");
    expect(payload).not.toContain("/var/lib/immich");
    expect(payload).not.toContain("\\\\\\\\fileserver\\\\private");
    expect(payload).not.toContain("0177.0.0.1");
    expect(payload).not.toContain("0x7f000001");
    expect(payload).not.toContain("2130706433");
    expect(payload).not.toContain("127.1");
    expect(projected.routePath).toBe("/api/proof/receipts");
    expect(projected.publicFileUrl).toBe(
      "https://example.com/var/lib/public-proof.json",
    );
  });
});
