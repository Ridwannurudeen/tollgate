import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readLedger, verifyLedgerIntegrity } from "./ledger";
import {
  authenticateWordPressSite,
  buildWordPressProof,
  readWordPressSites,
  registerWordPressSite,
  settleWordPressPost,
  wordpressPostStatus,
} from "./wordpress";
import type { QueryRecord, ReceiptEvidence } from "./types";

const wallet = "0x7777777777777777777777777777777777777777";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "tollgate-wordpress-"));
}

describe("WordPress settlement integration", () => {
  it("registers a site with a hashed API key and authenticates only that key", async () => {
    const dir = await tempDir();
    const sitesPath = path.join(dir, "wordpress-sites.json");
    try {
      const result = await registerWordPressSite(
        {
          siteUrl: "https://Publisher.example/blog/?utm=drop#frag",
          creatorWallet: wallet,
          apiKeySeed: "operator-seed",
        },
        sitesPath,
        new Date("2026-07-07T00:00:00.000Z"),
      );
      const registry = await readWordPressSites(sitesPath);
      const authed = await authenticateWordPressSite(result.apiKey, sitesPath);

      expect(result.apiKey).toMatch(/^tgwp_[0-9a-f]{64}$/);
      expect(result.site).toEqual({
        id: expect.stringMatching(/^wp_[0-9a-f]{12}$/),
        siteUrl: "https://publisher.example/blog",
        creatorWallet: wallet,
        registeredAt: "2026-07-07T00:00:00.000Z",
      });
      expect(JSON.stringify(registry)).not.toContain(result.apiKey);
      expect(registry.sites[0].apiKeyHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(authed?.id).toBe(result.site.id);
      await expect(
        authenticateWordPressSite("tgwp_wrong", sitesPath),
      ).resolves.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("settles a WordPress post once for a stable event id", async () => {
    const dir = await tempDir();
    const sitesPath = path.join(dir, "wordpress-sites.json");
    const ledgerPath = path.join(dir, "ledger.json");
    try {
      const registered = await registerWordPressSite(
        {
          siteUrl: "https://publisher.example",
          creatorWallet: wallet,
          apiKeySeed: "operator-seed",
        },
        sitesPath,
      );
      const site = await authenticateWordPressSite(registered.apiKey, sitesPath);
      if (!site) throw new Error("missing test site");
      const routeCitationPayments = vi.fn(async (query: QueryRecord) => {
        const citation = query.citations[0];
        return {
          [citation.sourceId]: {
            settlementMode: "forum-routed",
            payer: "0x9999999999999999999999999999999999999999",
            transaction: `0x${"a".repeat(64)}`,
            paymentResource: "forum-fee-router:test",
            feeRouterSplitId: "1",
            feeRouterCreateSplitTx: `0x${"b".repeat(64)}`,
            feeRouterPayTx: `0x${"a".repeat(64)}`,
          } satisfies ReceiptEvidence,
        };
      });
      const body = {
        priceAtomicUsdc: 2500,
        requesterFingerprint: "reader-1",
        title: "Private research note",
        postUrl: "https://publisher.example/private-note",
      };

      const first = await settleWordPressPost(site, "42", body, {
        ledgerPath,
        routeCitationPayments,
        now: () => new Date("2026-07-07T01:00:00.000Z"),
      });
      const second = await settleWordPressPost(site, "42", body, {
        ledgerPath,
        routeCitationPayments,
      });
      const ledger = await readLedger(ledgerPath);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.receipt.receiptHash).toBe(first.receipt.receiptHash);
      expect(routeCitationPayments).toHaveBeenCalledTimes(1);
      expect(ledger.receipts).toHaveLength(1);
      expect(ledger.receipts[0]).toMatchObject({
        queryId: first.eventId,
        sourceId: `wordpress:${site.id}:42`,
        wallet,
        amountAtomicUsdc: 2500,
        settlementMode: "forum-routed",
      });
      expect(first.query.citations[0]).toMatchObject({
        verifiedCreator: false,
        creatorClaimed: true,
        ownershipProof: { method: "creator-claimed" },
      });
      expect(verifyLedgerIntegrity(ledger).ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scopes post status to the authenticated site", async () => {
    const dir = await tempDir();
    const sitesPath = path.join(dir, "wordpress-sites.json");
    const ledgerPath = path.join(dir, "ledger.json");
    try {
      const firstRegistration = await registerWordPressSite(
        {
          siteUrl: "https://first.example",
          creatorWallet: wallet,
          apiKeySeed: "first-seed",
        },
        sitesPath,
      );
      const secondRegistration = await registerWordPressSite(
        {
          siteUrl: "https://second.example",
          creatorWallet: "0x8888888888888888888888888888888888888888",
          apiKeySeed: "second-seed",
        },
        sitesPath,
      );
      const first = await authenticateWordPressSite(
        firstRegistration.apiKey,
        sitesPath,
      );
      const second = await authenticateWordPressSite(
        secondRegistration.apiKey,
        sitesPath,
      );
      if (!first || !second) throw new Error("missing test sites");
      const body = {
        priceAtomicUsdc: 2500,
        requesterFingerprint: "same-reader",
      };

      await settleWordPressPost(first, "7", body, {
        ledgerPath,
        routeCitationPayments: async () => ({}),
      });

      await expect(
        wordpressPostStatus(first, "7", body, { ledgerPath }),
      ).resolves.toMatchObject({ paid: true });
      await expect(
        wordpressPostStatus(second, "7", body, { ledgerPath }),
      ).resolves.toMatchObject({ paid: false });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("builds a WordPress-only proof feed while verifying the full ledger", async () => {
    const dir = await tempDir();
    const sitesPath = path.join(dir, "wordpress-sites.json");
    const ledgerPath = path.join(dir, "ledger.json");
    try {
      const registered = await registerWordPressSite(
        {
          siteUrl: "https://publisher.example",
          creatorWallet: wallet,
          apiKeySeed: "operator-seed",
        },
        sitesPath,
      );
      const site = await authenticateWordPressSite(registered.apiKey, sitesPath);
      if (!site) throw new Error("missing test site");
      await settleWordPressPost(
        site,
        "proof-post",
        { priceAtomicUsdc: 2500, requesterFingerprint: "reader" },
        { ledgerPath, routeCitationPayments: async () => ({}) },
      );

      const proof = await buildWordPressProof(() => readLedger(ledgerPath));

      expect(proof.project).toBe("tollgate-wordpress");
      expect(proof.ledger.valid).toBe(true);
      expect(proof.ledger.wordpressReceiptCount).toBe(1);
      expect(proof.receipts[0].queryId).toMatch(/^wordpress:/);
      expect(proof.queries[0].id).toMatch(/^wordpress:/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
