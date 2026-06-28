import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  appendSource,
  buildSourceOwnershipMessage,
  findSource,
  normalizeSourceInput,
} from "./catalog";
import {
  createSourceAccessRecord,
  createQueryRecord,
  DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  planCitationMarket,
  selectSources,
} from "./engine";
import { configuredPaymentEconomics } from "./economics";
import {
  appendSettlement,
  createReceipts,
  getAnswerEvidence,
  getCreatorEvidence,
  getJudgeDemoEvidence,
  getSourceEvidence,
  readLedger,
  summarizeCreators,
  verifyLedgerIntegrity,
} from "./ledger";
import { PAID_QUERY_PRICE_ATOMIC_USDC } from "./payments";
import type { Ledger } from "./types";
import { createQueryPaymentEvidence, validateQuestion } from "./settlement";

describe("LeptonWeb settlement engine", () => {
  it("selects creator sources that match the question", () => {
    const sources = selectSources(
      "How should AI agents pay creators with x402?",
    );

    expect(sources.map((source) => source.id)).toContain("canteen-lepton-rfb");
    expect(sources.map((source) => source.id)).toContain("circle-gateway-nano");
  });

  it("creates a hash-linked receipt chain for every paid citation", () => {
    const query = createQueryRecord(
      "How should an Arc agent pay publishers per citation?",
      "2026-06-16T12:00:00.000Z",
    );
    const receipts = createReceipts(query, []);

    expect(receipts).toHaveLength(query.citations.length);
    expect(receipts[0]?.previousHash).toMatch(/^0x0+$/);
    expect(receipts[1]?.previousHash).toBe(receipts[0]?.receiptHash);
    expect(receipts[0]?.paymentResource).toBe(
      `/api/sources/${query.citations[0]?.sourceId}`,
    );
    expect(receipts[0]?.canonicalUrl).toBe(query.citations[0]?.canonicalUrl);
    expect(receipts[0]?.sourceContentHash).toBe(
      query.citations[0]?.sourceContentHash,
    );
    expect(receipts[0]?.sourceExcerptHash).toBe(
      query.citations[0]?.sourceExcerptHash,
    );
    expect(receipts[0]?.contentFetchedAt).toBe(
      query.citations[0]?.contentFetchedAt,
    );
    expect(receipts[0]?.settlementMode).toBe("local-proof");
    expect(query.totalAtomicUsdc).toBeGreaterThan(0);
    expect(query.agentBudget?.spentAtomicUsdc).toBe(query.totalAtomicUsdc);
    expect(query.sourceDecisions?.some((decision) => !decision.selected)).toBe(
      true,
    );
  });

  it("skips lower-value sources when the source budget is exhausted", () => {
    const plan = planCitationMarket(
      "How should AI agents pay creators with x402?",
      [
        {
          id: "cheap-relevant",
          title: "Cheap x402 Creator Notes",
          creator: "Creator A",
          handle: "@a",
          wallet: "0x1111111111111111111111111111111111111111",
          url: "https://example.com/a",
          summary: "AI agents pay creators with x402 citations.",
          tags: ["agents", "creators", "x402"],
          priceAtomicUsdc: 900,
          sourceKind: "internal-test",
          creatorKind: "internal-test",
          verifiedCreator: false,
        },
        {
          id: "expensive-relevant",
          title: "Premium x402 Creator Notes",
          creator: "Creator B",
          handle: "@b",
          wallet: "0x2222222222222222222222222222222222222222",
          url: "https://example.com/b",
          summary: "AI agents pay creators with x402 citations and budgets.",
          tags: ["agents", "creators", "x402"],
          priceAtomicUsdc: 1_900,
          sourceKind: "internal-test",
          creatorKind: "internal-test",
          verifiedCreator: false,
        },
      ],
      3,
      1_000,
    );

    expect(plan.selectedSources.map((source) => source.id)).toEqual([
      "cheap-relevant",
    ]);
    expect(plan.budget.spentAtomicUsdc).toBe(900);
    expect(
      plan.decisions.find(
        (decision) => decision.sourceId === "expensive-relevant",
      )?.selected,
    ).toBe(false);
  });

  it("keeps the configured source budget inside the reader payment", () => {
    const economics = configuredPaymentEconomics();

    expect(DEFAULT_SOURCE_BUDGET_ATOMIC_USDC).toBeLessThanOrEqual(
      PAID_QUERY_PRICE_ATOMIC_USDC,
    );
    expect(economics.readerPaidAtomicUsdc).toBe(10_000);
    expect(economics.creatorPayoutsAtomicUsdc).toBe(6_500);
    expect(economics.protocolRetainedAtomicUsdc).toBe(3_500);
    expect(economics.budgetUtilizationPercent).toBe(65);
  });

  it("summarizes creator earnings from query citations", () => {
    const query = createQueryRecord(
      "Why do Gateway nanopayments matter for creator citations?",
      "2026-06-16T12:00:00.000Z",
    );
    const ledger: Ledger = {
      queries: [query],
      receipts: createReceipts(query, []),
    };
    const creators = summarizeCreators(ledger);

    expect(creators.length).toBeGreaterThan(0);
    expect(creators[0]?.earnedAtomicUsdc).toBeGreaterThan(0);
    expect(creators[0]?.citationCount).toBeGreaterThan(0);
  });

  it("builds shareable creator and source evidence from receipts", () => {
    const query = createQueryRecord(
      "How should AI agents pay publishers per citation?",
      "2026-06-16T12:00:00.000Z",
    );
    const receipts = createReceipts(query, []);
    const ledger: Ledger = {
      queries: [
        {
          ...query,
          receiptHashes: receipts.map((receipt) => receipt.receiptHash),
        },
      ],
      receipts,
    };
    const firstReceipt = receipts[0];
    if (!firstReceipt) throw new Error("missing test receipt");

    const creatorEvidence = getCreatorEvidence(ledger, firstReceipt.wallet);
    const sourceEvidence = getSourceEvidence(ledger, firstReceipt.sourceId);

    expect(creatorEvidence?.wallet).toBe(firstReceipt.wallet);
    expect(creatorEvidence?.receipts[0]?.receiptHash).toBe(
      firstReceipt.receiptHash,
    );
    expect(creatorEvidence?.sources.length).toBeGreaterThan(0);
    expect(sourceEvidence?.sourceId).toBe(firstReceipt.sourceId);
    expect(sourceEvidence?.earnedAtomicUsdc).toBe(
      firstReceipt.amountAtomicUsdc,
    );
  });

  it("builds shareable answer evidence by query id and answer hash", () => {
    const query = createQueryRecord(
      "How should AI agents pay publishers per citation?",
      "2026-06-16T12:00:00.000Z",
    );
    const receipts = createReceipts(query, []);
    const ledger: Ledger = {
      queries: [
        {
          ...query,
          receiptHashes: receipts.map((receipt) => receipt.receiptHash),
        },
      ],
      receipts,
    };

    const evidenceById = getAnswerEvidence(ledger, query.id);
    const evidenceByHash = getAnswerEvidence(ledger, query.answerHash);

    expect(evidenceById?.query.id).toBe(query.id);
    expect(evidenceById?.receipts).toHaveLength(receipts.length);
    expect(evidenceByHash?.query.answerHash).toBe(query.answerHash);
    expect(evidenceByHash?.receipts[0]?.queryId).toBe(query.id);
  });

  it("selects the latest judge demo evidence anchors", async () => {
    const source = await findSource("circle-gateway-nano");
    if (!source) throw new Error("missing test source");
    const localQuery = createQueryRecord(
      "How should a budgeted AI agent buy citations without overspending?",
      "2026-06-16T12:00:00.000Z",
    );
    const readerPayment = createQueryPaymentEvidence({
      amountAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
      settlementMode: "x402-verified",
      payTo: "0x22949cA9A470181c66a034E81a743E2518579E95",
      payer: "0x8888888888888888888888888888888888888888",
      paymentResource: "/api/paid-query",
    });
    const paidQuery = createQueryRecord(
      "How does Tollgate prove reader-paid answers on Arc?",
      "2026-06-16T12:01:00.000Z",
      undefined,
      readerPayment,
    );
    const sourceQuery = createSourceAccessRecord(
      source,
      "2026-06-16T12:02:00.000Z",
    );
    const localReceipts = createReceipts(localQuery, []);
    const paidReceipts = createReceipts(paidQuery, localReceipts);
    const sourceReceipts = createReceipts(
      sourceQuery,
      [...localReceipts, ...paidReceipts],
      {
        [source.id]: {
          settlementMode: "x402-verified",
          payer: "0x7777777777777777777777777777777777777777",
          paymentResource: `/api/sources/${source.id}`,
        },
      },
    );
    const ledger: Ledger = {
      queries: [
        {
          ...sourceQuery,
          receiptHashes: sourceReceipts.map((receipt) => receipt.receiptHash),
        },
        {
          ...paidQuery,
          receiptHashes: paidReceipts.map((receipt) => receipt.receiptHash),
        },
        {
          ...localQuery,
          receiptHashes: localReceipts.map((receipt) => receipt.receiptHash),
        },
      ],
      receipts: [...localReceipts, ...paidReceipts, ...sourceReceipts],
    };

    const demo = getJudgeDemoEvidence(ledger);

    expect(demo.localAnswer?.query.id).toBe(localQuery.id);
    expect(demo.paidAnswer?.query.id).toBe(paidQuery.id);
    expect(demo.sourcePurchase?.query.id).toBe(sourceQuery.id);
    expect(demo.sourcePurchase?.receipts[0]?.settlementMode).toBe(
      "x402-verified",
    );
  });

  it("records x402 source access evidence in receipt hashes", async () => {
    const source = await findSource("circle-gateway-nano");
    if (!source) throw new Error("missing test source");
    const query = createSourceAccessRecord(source, "2026-06-16T12:00:00.000Z");
    const receipts = createReceipts(query, [], {
      [source.id]: {
        settlementMode: "x402-verified",
        payer: "0x7777777777777777777777777777777777777777",
        paymentResource: `/api/sources/${source.id}`,
      },
    });

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.settlementMode).toBe("x402-verified");
    expect(receipts[0]?.payer).toBe(
      "0x7777777777777777777777777777777777777777",
    );
    expect(receipts[0]?.paymentResource).toBe(
      "/api/sources/circle-gateway-nano",
    );
    expect(receipts[0]?.receiptHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("records Forum FeeRouter evidence in receipt hashes", () => {
    const query = createQueryRecord(
      "How does Tollgate route citation payments through Forum?",
      "2026-06-23T12:00:00.000Z",
    );
    const sourceId = query.citations[0]?.sourceId;
    if (!sourceId) throw new Error("missing test citation");
    const receipts = createReceipts(query, [], {
      [sourceId]: {
        settlementMode: "forum-routed",
        payer: "0x7777777777777777777777777777777777777777",
        transaction:
          "0x0157f03ae6a0bfe8f4947274b4c12254b92a198bb620cb3d27d9233c743e9eff",
        paymentResource:
          "forum-fee-router:0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59",
        feeRouterSplitId: "1",
        feeRouterCreateSplitTx:
          "0xa9ad8ea73dba76962974c64e4a6276acb1fcdc709370577e0663322e37118510",
        feeRouterPayTx:
          "0x0157f03ae6a0bfe8f4947274b4c12254b92a198bb620cb3d27d9233c743e9eff",
      },
    });

    expect(receipts[0]?.settlementMode).toBe("forum-routed");
    expect(receipts[0]?.feeRouterSplitId).toBe("1");
    expect(receipts[0]?.feeRouterPayTx).toBe(
      "0x0157f03ae6a0bfe8f4947274b4c12254b92a198bb620cb3d27d9233c743e9eff",
    );
    expect(
      verifyLedgerIntegrity({
        queries: [
          {
            ...query,
            receiptHashes: receipts.map((receipt) => receipt.receiptHash),
          },
        ],
        receipts,
      }).ok,
    ).toBe(true);
  });

  it("rejects under-specified questions", () => {
    expect(() => validateQuestion("pay?")).toThrow(/at least 8/);
  });

  it("normalizes creator source registrations", () => {
    const source = normalizeSourceInput({
      title: "  Independent Research Feed  ",
      creator: "Source Lab",
      handle: "sourcelab",
      wallet: "0x7777777777777777777777777777777777777777",
      url: "https://example.com/research",
      summary: "A paid source for agent research.",
      tags: "research, agents, research",
      priceAtomicUsdc: "2500",
    });

    expect(source.id).toBe("independent-research-feed");
    expect(source.handle).toBe("@sourcelab");
    expect(source.tags).toEqual(["research", "agents"]);
    expect(source.priceAtomicUsdc).toBe(2500);
    expect(source.sourceKind).toBe("external");
    expect(source.verifiedCreator).toBe(false);
  });

  it("marks a source verified when ownership signature recovers the wallet", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-sources-"));
    const filePath = path.join(dir, "sources.json");
    const account = privateKeyToAccount(generatePrivateKey());
    const timestamp = "2026-06-27T12:00:00.000Z";
    const sourceUrl = "https://example.com/signed-research";
    const signature = await account.signMessage({
      message: buildSourceOwnershipMessage({
        sourceUrl,
        wallet: account.address,
        timestamp,
      }),
    });

    try {
      const result = await appendSource(
        {
          title: "Signed Research Feed",
          creator: "Verified Lab",
          handle: "@verified",
          wallet: account.address,
          url: sourceUrl,
          summary: "Verified owner content for agent citation tests.",
          tags: ["verified", "agents"],
          priceAtomicUsdc: 2500,
          ownershipSignature: signature,
          ownershipTimestamp: timestamp,
        },
        filePath,
      );

      expect(result.source.verifiedCreator).toBe(true);
      expect(result.source.ownershipProof?.method).toBe("wallet-signature");
      expect(result.source.ownershipProof?.signer).toBe(account.address);
      expect(result.source.ownershipProof?.signatureHash).toMatch(
        /^0x[0-9a-f]{64}$/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a source ownership signature from the wrong wallet", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-sources-"));
    const filePath = path.join(dir, "sources.json");
    const owner = privateKeyToAccount(generatePrivateKey());
    const signer = privateKeyToAccount(generatePrivateKey());
    const timestamp = "2026-06-27T12:00:00.000Z";
    const sourceUrl = "https://example.com/wrong-signer";
    const signature = await signer.signMessage({
      message: buildSourceOwnershipMessage({
        sourceUrl,
        wallet: owner.address,
        timestamp,
      }),
    });

    try {
      await expect(
        appendSource(
          {
            title: "Wrong Signer Feed",
            creator: "Verifier Lab",
            handle: "@wrong",
            wallet: owner.address,
            url: sourceUrl,
            summary: "This source should not verify against the wrong signer.",
            tags: ["verified"],
            priceAtomicUsdc: 2500,
            ownershipSignature: signature,
            ownershipTimestamp: timestamp,
          },
          filePath,
        ),
      ).rejects.toThrow("ownershipSignature");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("verifies the receipt hash chain and query references", () => {
    const query = createQueryRecord(
      "How should AI agents pay publishers per citation?",
      "2026-06-16T12:00:00.000Z",
    );
    const receipts = createReceipts(query, []);
    const ledger: Ledger = {
      queries: [
        {
          ...query,
          receiptHashes: receipts.map((receipt) => receipt.receiptHash),
        },
      ],
      receipts,
    };

    const verification = verifyLedgerIntegrity(ledger);

    expect(verification.ok).toBe(true);
    expect(verification.receiptCount).toBe(receipts.length);
    expect(verification.latestHash).toBe(receipts.at(-1)?.receiptHash);
  });

  it("serializes concurrent ledger appends without dropping receipts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-ledger-"));
    const filePath = path.join(dir, "ledger.json");
    try {
      const queries = [
        createQueryRecord(
          "How do agents preserve creator revenue across reused sources?",
          "2026-06-16T12:00:00.000Z",
        ),
        createQueryRecord(
          "How does Tollgate prove every paid answer keeps receipts linked?",
          "2026-06-16T12:01:00.000Z",
        ),
        createQueryRecord(
          "How should x402 citation payouts stay auditable under load?",
          "2026-06-16T12:02:00.000Z",
        ),
      ];

      await Promise.all(
        queries.map((query) => appendSettlement(query, {}, filePath)),
      );

      const ledger = await readLedger(filePath);
      const expectedReceiptCount = queries.reduce(
        (sum, query) => sum + query.citations.length,
        0,
      );
      const verification = verifyLedgerIntegrity(ledger);

      expect(ledger.queries).toHaveLength(queries.length);
      expect(ledger.receipts).toHaveLength(expectedReceiptCount);
      expect(verification.ok).toBe(true);
      expect(verification.latestHash).toBe(
        ledger.receipts.at(-1)?.receiptHash,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("binds paid query receipts to the reader payment hash", () => {
    const readerPayment = createQueryPaymentEvidence({
      amountAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
      settlementMode: "x402-verified",
      payTo: "0x22949cA9A470181c66a034E81a743E2518579E95",
      payer: "0x8888888888888888888888888888888888888888",
      paymentResource: "/api/paid-query",
    });
    const query = createQueryRecord(
      "How does Tollgate prove paid citations with x402 receipts on Arc?",
      "2026-06-16T12:00:00.000Z",
      undefined,
      readerPayment,
    );
    const receipts = createReceipts(query, []);
    const ledger: Ledger = {
      queries: [
        {
          ...query,
          receiptHashes: receipts.map((receipt) => receipt.receiptHash),
        },
      ],
      receipts,
    };
    const verification = verifyLedgerIntegrity(ledger);

    expect(readerPayment.paymentHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(receipts[0]?.queryPaymentHash).toBe(readerPayment.paymentHash);
    expect(verification.ok).toBe(true);
  });
});
