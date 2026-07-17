import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  projectPublicData,
  publicLedger,
  publicSettlementResult,
} from "./public-data";
import type { Ledger, SettlementResult } from "./types";

describe("Citations public data projections", () => {
  it("redacts nested emails and private URLs without mutating hash-bound records", () => {
    const receiptHash = `0x${"3".repeat(64)}`;
    const ledger = {
      queries: [
        {
          id: "query-1",
          question: "Ask history@example.com",
          answer: "See http://127.0.0.1:4318/private for history@example.com",
          queryHash: `0x${"1".repeat(64)}`,
          answerHash: `0x${"2".repeat(64)}`,
          totalAtomicUsdc: 1_500,
          citations: [
            {
              sourceId: "source-1",
              title: "history@example.com",
              creator: "history@example.com",
              handle: "@history",
              wallet: "0x7777777777777777777777777777777777777777" as const,
              url: "http://[::ffff:127.0.0.1]/private",
              amountAtomicUsdc: 1_500,
              reason: "Contact history@example.com",
            },
          ],
          receiptHashes: [receiptHash],
          trackRecord: {
            botId:
              "0x1111111111111111111111111111111111111111111111111111111111111111" as const,
            seq: 1,
            recordHash: `0x${"4".repeat(64)}` as `0x${string}`,
            transaction: `0x${"5".repeat(64)}` as `0x${string}`,
            evidenceUri: "http://10.0.0.9/private",
            evidenceHash: `0x${"6".repeat(64)}` as `0x${string}`,
            publishedAt: "2026-07-05T00:00:00.000Z",
          },
          createdAt: "2026-07-05T00:00:00.000Z",
        },
      ],
      receipts: [
        {
          id: "receipt-1",
          queryId: "query-1",
          sourceId: "source-1",
          creator: "history@example.com",
          wallet: "0x7777777777777777777777777777777777777777" as const,
          amountAtomicUsdc: 1_500,
          settlementMode: "local-proof" as const,
          paymentResource: "http://192.168.1.5/private",
          previousHash: `0x${"0".repeat(64)}`,
          receiptHash,
          createdAt: "2026-07-05T00:00:00.000Z",
        },
      ],
    } satisfies Ledger;

    const projected = publicLedger(ledger);
    const payload = JSON.stringify(projected);

    expect(payload).not.toContain("history@example.com");
    expect(payload).not.toContain("127.0.0.1");
    expect(payload).not.toContain("10.0.0.9");
    expect(payload).not.toContain("192.168.1.5");
    expect(projected.queries[0].queryHash).toBe(ledger.queries[0].queryHash);
    expect(projected.queries[0].answerHash).toBe(ledger.queries[0].answerHash);
    expect(projected.receipts[0].receiptHash).toBe(receiptHash);
    expect(ledger.queries[0].question).toBe("Ask history@example.com");
    expect(ledger.receipts[0].paymentResource).toBe(
      "http://192.168.1.5/private",
    );
  });

  it("projects every copy of a settlement result", () => {
    const result = {
      query: {
        id: "query-1",
        question: "Ask result@example.com",
        answer: "Answer result@example.com",
        queryHash: `0x${"1".repeat(64)}`,
        answerHash: `0x${"2".repeat(64)}`,
        totalAtomicUsdc: 0,
        citations: [],
        receiptHashes: [],
        createdAt: "2026-07-05T00:00:00.000Z",
      },
      receipts: [],
      ledger: { queries: [], receipts: [] },
    } satisfies SettlementResult;

    const projected = publicSettlementResult(result);

    expect(JSON.stringify(projected)).not.toContain("result@example.com");
    expect(projected.query.queryHash).toBe(result.query.queryHash);
    expect(result.query.question).toBe("Ask result@example.com");
  });

  it("keeps public URLs while removing embedded private URL literals", () => {
    const projected = projectPublicData({
      publicUrl: "https://example.com/evidence",
      privateUrl: "http://localhost:3000/private",
      detail:
        "Public https://example.com/evidence, private http://172.16.0.4/log.",
    });

    expect(projected.publicUrl).toBe("https://example.com/evidence");
    expect(projected.privateUrl).toBe("[redacted-private-url]");
    expect(projected.detail).toContain("https://example.com/evidence");
    expect(projected.detail).not.toContain("172.16.0.4");
  });

  it("redacts all bare IP addresses and host paths without hiding routes", () => {
    const projected = projectPublicData({
      detail:
        "Hosts 10.23.4.5, fd12:3456::9, and ::ffff:127.0.0.1 wrote C:\\Tollgate\\private\\ledger.json and /var/lib/tollgate/private/ledger.json.",
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
    expect(payload).not.toContain("C:\\\\Tollgate\\\\private");
    expect(payload).not.toContain("/var/lib/tollgate");
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
      windowsPath: "path=C:\\Tollgate\\private\\ledger.json",
      posixPath: "path=/var/lib/tollgate/private/ledger.json",
      uncPath: "path=\\\\fileserver\\private\\ledger.json",
      alternateLoopbacks:
        "Hosts 0177.0.0.1, 0x7f000001, 2130706433, and 127.1.",
      routePath: "/api/proof/receipts",
      publicFileUrl: "https://example.com/var/lib/public-proof.json",
    });
    const payload = JSON.stringify(projected);

    expect(payload).not.toContain("C:\\\\Tollgate\\\\private");
    expect(payload).not.toContain("/var/lib/tollgate");
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

  it("projects stored free text before public server-rendered pages use it", async () => {
    const ledgerPages = [
      "src/app/sources/[sourceId]/page.tsx",
      "src/app/answers/[queryId]/page.tsx",
      "src/app/receipts/[hash]/page.tsx",
      "src/app/creators/page.tsx",
      "src/app/creators/[wallet]/page.tsx",
      "src/app/register/page.tsx",
    ];
    const sourcePages = [
      "src/app/sources/page.tsx",
      "src/app/sources/[sourceId]/page.tsx",
      "src/app/creators/page.tsx",
      "src/app/creators/[wallet]/page.tsx",
      "src/app/register/page.tsx",
      "src/app/proof/page.tsx",
    ];

    for (const filePath of ledgerPages) {
      const source = await readFile(
        path.join(process.cwd(), filePath),
        "utf8",
      );
      expect(source, filePath).toContain("publicLedger(");
    }
    for (const filePath of sourcePages) {
      const source = await readFile(
        path.join(process.cwd(), filePath),
        "utf8",
      );
      expect(source, filePath).toContain("publicSource(");
    }
  });
});
