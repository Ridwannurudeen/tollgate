import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readLedger, verifyLedgerIntegrity } from "./ledger";
import { tollgateAgentWallet } from "./payments";
import {
  authenticateWordPressSite,
  authorizeWordPressRegistration,
  buildWordPressProof,
  readWordPressSites,
  registerWordPressSite,
  settleWordPressPost,
  type WordPressSite,
  wordpressPostStatus,
} from "./wordpress";
import type {
  QueryPaymentEvidence,
  QueryRecord,
  ReceiptEvidence,
} from "./types";

const wallet = "0x7777777777777777777777777777777777777777" as const;

function readerPayment(
  amountAtomicUsdc = 2500,
): Omit<QueryPaymentEvidence, "paymentHash"> {
  return {
    amountAtomicUsdc,
    settlementMode: "x402-settled",
    payTo: tollgateAgentWallet(),
    payer: "0x9999999999999999999999999999999999999999",
    transaction: `0x${"f".repeat(64)}`,
    paymentResource: "/api/wordpress/posts/42/pay",
  };
}

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "tollgate-wordpress-"));
}

describe("WordPress settlement integration", () => {
  it("fails closed unless the configured registration capability matches", () => {
    const previous = process.env.TOLLGATE_WORDPRESS_REGISTRATION_SECRET;
    try {
      delete process.env.TOLLGATE_WORDPRESS_REGISTRATION_SECRET;
      expect(authorizeWordPressRegistration(null)).toBe(false);
      expect(authorizeWordPressRegistration("registration-capability")).toBe(
        false,
      );

      process.env.TOLLGATE_WORDPRESS_REGISTRATION_SECRET =
        "registration-capability";
      expect(authorizeWordPressRegistration(null)).toBe(false);
      expect(authorizeWordPressRegistration("wrong-capability")).toBe(false);
      expect(authorizeWordPressRegistration("registration-capability")).toBe(
        true,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TOLLGATE_WORDPRESS_REGISTRATION_SECRET;
      } else {
        process.env.TOLLGATE_WORDPRESS_REGISTRATION_SECRET = previous;
      }
    }
  });

  it("registers a site with a hashed API key and authenticates only that key", async () => {
    const dir = await tempDir();
    const sitesPath = path.join(dir, "wordpress-sites.json");
    try {
      const result = await registerWordPressSite(
        {
          siteUrl: "https://Publisher.example/blog/?utm=drop#frag",
          creatorWallet: wallet,
          apiKeySeed: "operator-seed",
          priceAtomicUsdc: 2500,
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
        priceAtomicUsdc: 2500,
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

  it("does not let a second registration replace an approved site binding", async () => {
    const dir = await tempDir();
    const sitesPath = path.join(dir, "wordpress-sites.json");
    try {
      const first = await registerWordPressSite(
        {
          siteUrl: "https://publisher.example",
          creatorWallet: wallet,
          apiKeySeed: "first-operator-seed",
          priceAtomicUsdc: 2500,
        },
        sitesPath,
      );

      await expect(
        registerWordPressSite(
          {
            siteUrl: "https://publisher.example/",
            creatorWallet: "0x8888888888888888888888888888888888888888",
            apiKeySeed: "second-operator-seed",
            priceAtomicUsdc: 999_999_999,
          },
          sitesPath,
        ),
      ).rejects.toMatchObject({ status: 409 });

      const registry = await readWordPressSites(sitesPath);
      expect(registry.sites).toHaveLength(1);
      expect(registry.sites[0]).toMatchObject({
        id: first.site.id,
        creatorWallet: wallet,
        priceAtomicUsdc: 2500,
      });
      await expect(
        authenticateWordPressSite(first.apiKey, sitesPath),
      ).resolves.toMatchObject({
        creatorWallet: wallet,
        priceAtomicUsdc: 2500,
      });
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
          priceAtomicUsdc: 2500,
        },
        sitesPath,
      );
      const site = await authenticateWordPressSite(
        registered.apiKey,
        sitesPath,
      );
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
        readerPayment: readerPayment(),
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

  it("does not route a creator payout without settled reader-payment evidence", async () => {
    const site: WordPressSite = {
      id: "wp_site",
      siteUrl: "https://publisher.example/",
      creatorWallet: wallet,
      priceAtomicUsdc: 2500,
      apiKeyHash: `0x${"a".repeat(64)}`,
      registeredAt: "2026-07-07T00:00:00.000Z",
    };
    const routeCitationPayments = vi.fn();
    const appendSettlement = vi.fn();

    await expect(
      settleWordPressPost(
        site,
        "42",
        { requesterFingerprint: "reader" },
        {
          readLedger: async () => ({ queries: [], receipts: [] }),
          routeCitationPayments,
          appendSettlement,
        },
      ),
    ).rejects.toMatchObject({
      message: "reader payment authorization required",
      status: 402,
    });

    expect(routeCitationPayments).not.toHaveBeenCalled();
    expect(appendSettlement).not.toHaveBeenCalled();
  });

  it("uses the approved site, wallet, and price instead of caller overrides", async () => {
    const site: WordPressSite = {
      id: "wp_site",
      siteUrl: "https://publisher.example/",
      creatorWallet: wallet,
      priceAtomicUsdc: 2500,
      apiKeyHash: `0x${"a".repeat(64)}` as `0x${string}`,
      registeredAt: "2026-07-07T00:00:00.000Z",
    };
    const routeCitationPayments = vi.fn(async (query: QueryRecord) => {
      expect(query.totalAtomicUsdc).toBe(2500);
      expect(query.question).toContain("https://publisher.example/");
      expect(query.question).not.toContain("attacker.example");
      expect(query.citations[0]).toMatchObject({
        wallet,
        amountAtomicUsdc: 2500,
        url: "https://publisher.example/?p=42",
      });
      return {};
    });

    await settleWordPressPost(
      site,
      "42",
      {
        siteUrl: "https://attacker.example",
        creatorWallet: "0x8888888888888888888888888888888888888888",
        priceAtomicUsdc: 999_999_999,
        postUrl: "https://attacker.example/redirect",
        requesterFingerprint: "reader",
      },
      {
        readerPayment: readerPayment(),
        readLedger: async () => ({ queries: [], receipts: [] }),
        routeCitationPayments,
        appendSettlement: async (query) => ({
          query,
          receipts: [
            {
              id: "receipt",
              queryId: query.id,
              sourceId: query.citations[0].sourceId,
              creator: query.citations[0].creator,
              wallet: query.citations[0].wallet,
              amountAtomicUsdc: query.citations[0].amountAtomicUsdc,
              settlementMode: "local-proof",
              previousHash: `0x${"0".repeat(64)}`,
              receiptHash: `0x${"1".repeat(64)}`,
              createdAt: query.createdAt,
            },
          ],
          ledger: { queries: [query], receipts: [] },
        }),
      },
    );

    expect(routeCitationPayments).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent settlement attempts for the same event", async () => {
    const dir = await tempDir();
    const sitesPath = path.join(dir, "wordpress-sites.json");
    const ledgerPath = path.join(dir, "ledger.json");
    try {
      const registered = await registerWordPressSite(
        {
          siteUrl: "https://publisher.example",
          creatorWallet: wallet,
          apiKeySeed: "operator-seed",
          priceAtomicUsdc: 2500,
        },
        sitesPath,
      );
      const site = await authenticateWordPressSite(
        registered.apiKey,
        sitesPath,
      );
      if (!site) throw new Error("missing test site");
      const routeCitationPayments = vi.fn(async () => {
        await Promise.resolve();
        return {};
      });
      const body = {
        requesterFingerprint: "same-reader",
        title: "Private research note",
      };

      const results = await Promise.all([
        settleWordPressPost(site, "42", body, {
          ledgerPath,
          readerPayment: readerPayment(),
          routeCitationPayments,
        }),
        settleWordPressPost(site, "42", body, {
          ledgerPath,
          readerPayment: readerPayment(),
          routeCitationPayments,
        }),
      ]);
      const ledger = await readLedger(ledgerPath);

      expect(routeCitationPayments).toHaveBeenCalledTimes(1);
      expect(results.map((result) => result.created).sort()).toEqual([
        false,
        true,
      ]);
      expect(ledger.queries).toHaveLength(1);
      expect(ledger.receipts).toHaveLength(1);
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
          priceAtomicUsdc: 2500,
        },
        sitesPath,
      );
      const secondRegistration = await registerWordPressSite(
        {
          siteUrl: "https://second.example",
          creatorWallet: "0x8888888888888888888888888888888888888888",
          apiKeySeed: "second-seed",
          priceAtomicUsdc: 2500,
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
        readerPayment: {
          ...readerPayment(),
          paymentResource: "/api/wordpress/posts/7/pay",
        },
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
          priceAtomicUsdc: 2500,
        },
        sitesPath,
      );
      const site = await authenticateWordPressSite(
        registered.apiKey,
        sitesPath,
      );
      if (!site) throw new Error("missing test site");
      await settleWordPressPost(
        site,
        "proof-post",
        { priceAtomicUsdc: 2500, requesterFingerprint: "reader" },
        {
          ledgerPath,
          readerPayment: {
            ...readerPayment(),
            paymentResource: "/api/wordpress/posts/proof-post/pay",
          },
          routeCitationPayments: async () => ({}),
        },
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

  it("redacts historical public proof text without rewriting ledger hashes", async () => {
    const receiptHash = `0x${"3".repeat(64)}`;
    const ledger = {
      queries: [
        {
          id: "wordpress:site:post:reader",
          question: "Paid access for history@example.com",
          answer: "Unlocked for history@example.com",
          queryHash: `0x${"1".repeat(64)}`,
          answerHash: `0x${"2".repeat(64)}`,
          totalAtomicUsdc: 2500,
          citations: [],
          receiptHashes: [receiptHash],
          createdAt: "2026-07-07T00:00:00.000Z",
        },
      ],
      receipts: [
        {
          id: "receipt-1",
          queryId: "wordpress:site:post:reader",
          sourceId: "wordpress:site:post",
          creator: "history@example.com",
          wallet,
          amountAtomicUsdc: 2500,
          settlementMode: "local-proof" as const,
          paymentResource: "http://127.0.0.1:3000/private",
          previousHash: `0x${"0".repeat(64)}`,
          receiptHash,
          createdAt: "2026-07-07T00:00:00.000Z",
        },
      ],
    };

    const proof = await buildWordPressProof(async () => ledger);
    const payload = JSON.stringify(proof);

    expect(payload).not.toContain("history@example.com");
    expect(payload).not.toContain("127.0.0.1");
    expect(proof.queries[0].queryHash).toBe(`0x${"1".repeat(64)}`);
    expect(proof.queries[0].answerHash).toBe(`0x${"2".repeat(64)}`);
    expect(proof.receipts[0].receiptHash).toBe(receiptHash);
    expect(ledger.queries[0].question).toBe(
      "Paid access for history@example.com",
    );
  });
});
