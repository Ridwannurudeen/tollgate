import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { releaseEscrowForSource } from "./escrow";
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
  ZERO_HASH,
} from "./ledger";
import { groundingYieldsBySource } from "./grounding-yield";
import { PAID_QUERY_PRICE_ATOMIC_USDC } from "./payments";
import type {
  CreatorSource,
  Ledger,
  PaymentReceipt,
  QueryRecord,
} from "./types";
import {
  PaidQueryAgentError,
  createQueryPaymentEvidence,
  filterSourcesForSettlement,
  leaveOneOutContributionEnabled,
  settlePaidQuestion,
  sourcesForAgent,
  validateQuestion,
} from "./settlement";

function testReceipt(
  sourceId: string,
  settlementMode: PaymentReceipt["settlementMode"],
  index: number,
): PaymentReceipt {
  return {
    id: `receipt-${sourceId}-${index}`,
    queryId: `query-${index}`,
    sourceId,
    creator: "Yield Lab",
    wallet: "0x1111111111111111111111111111111111111111",
    amountAtomicUsdc: 1_000,
    settlementMode,
    previousHash: `0x${"0".repeat(64)}`,
    receiptHash: `0x${String(index).repeat(64)}`,
    createdAt: "2026-07-03T00:00:00.000Z",
  };
}

async function withRegistrationFetchDisabled<T>(
  test: () => Promise<T>,
): Promise<T> {
  const previous = process.env.TOLLGATE_REGISTRATION_FETCH;
  process.env.TOLLGATE_REGISTRATION_FETCH = "0";
  try {
    return await test();
  } finally {
    if (previous === undefined) {
      delete process.env.TOLLGATE_REGISTRATION_FETCH;
    } else {
      process.env.TOLLGATE_REGISTRATION_FETCH = previous;
    }
  }
}

describe("LeptonWeb settlement engine", () => {
  it("gates leave-one-out contribution scoring by mode, env, and source cap", () => {
    const envNames = [
      "LEPTONWEB_CONTRIBUTION_PAYOUTS",
      "LEPTONWEB_LEAVE_ONE_OUT_CONTRIBUTION",
    ];
    const previous = new Map(
      envNames.map((name) => [name, process.env[name]]),
    );

    try {
      for (const name of envNames) delete process.env[name];
      expect(leaveOneOutContributionEnabled("judge-strict", 0)).toBe(false);
      expect(leaveOneOutContributionEnabled("judge-strict", 3)).toBe(true);
      expect(leaveOneOutContributionEnabled("production", 3)).toBe(false);

      process.env.LEPTONWEB_LEAVE_ONE_OUT_CONTRIBUTION = "0";
      expect(leaveOneOutContributionEnabled("judge-strict", 3)).toBe(false);

      process.env.LEPTONWEB_CONTRIBUTION_PAYOUTS = "1";
      process.env.LEPTONWEB_LEAVE_ONE_OUT_CONTRIBUTION = "1";
      expect(leaveOneOutContributionEnabled("production", 3)).toBe(true);
      expect(leaveOneOutContributionEnabled("production", 4)).toBe(false);

      process.env.LEPTONWEB_CONTRIBUTION_PAYOUTS = "0";
      expect(leaveOneOutContributionEnabled("judge-strict", 3)).toBe(false);
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("surfaces strict paid planner failures without writing a fallback query", async () => {
    const envNames = [
      "LEPTONWEB_AGENT_MODE",
      "LEPTONWEB_LLM_API_KEY",
      "OPENAI_API_KEY",
      "LEPTONWEB_LLM_MODEL",
      "LEPTONWEB_LLM_BASE_URL",
    ];
    const previous = new Map(
      envNames.map((name) => [name, process.env[name]]),
    );
    const before = await readLedger();
    for (const name of envNames) delete process.env[name];
    process.env.LEPTONWEB_AGENT_MODE = "judge-strict";

    try {
      let caught: unknown;
      try {
        await settlePaidQuestion("How does Forum bind agent spending?", {
          amountAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
          settlementMode: "x402-verified",
          payTo: "0x5C94b3aBb29c1dFcA24313B9A2D383960Cd69836",
          payer: "0x8888888888888888888888888888888888888888",
          paymentResource: "/api/paid-query",
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(PaidQueryAgentError);
      if (!(caught instanceof PaidQueryAgentError)) {
        throw new Error("expected PaidQueryAgentError");
      }
      expect(caught.message).toContain(
        "Reader refund could not be settled on-chain.",
      );
      expect(caught.stage).toBe("reader-refund");
      expect(caught.priorFailure).toEqual({
        stage: "configuration",
        message: "Judge-strict mode requires a configured LLM planner.",
      });
      expect(caught.readerPayment.paymentHash).toMatch(/^0x[0-9a-f]{64}$/);
      const after = await readLedger();
      expect(after.queries).toHaveLength(before.queries.length);
      expect(after.receipts).toHaveLength(before.receipts.length);
    } finally {
      for (const name of envNames) {
        const value = previous.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("selects creator sources that match the question", () => {
    const sources = selectSources(
      "How should AI agents pay creators with x402?",
    );

    // Assert intent, not exact ids: the deterministic scorer re-ranks as the
    // seed corpus grows, so pin to relevance (an x402-tagged source is bought)
    // rather than a specific source that a newer, closer match can displace.
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.some((source) => source.tags.includes("x402"))).toBe(true);
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

  it("uses grounding yield to break equal deterministic allocations", () => {
    const lowYieldSource: CreatorSource = {
      id: "low-yield-agent-payments",
      title: "Low Yield Agent Payments",
      creator: "Low Yield Lab",
      handle: "@low",
      wallet: "0x1111111111111111111111111111111111111111",
      url: "https://example.com/low",
      summary: "AI agents pay creators with citation receipts.",
      tags: ["agents", "creators"],
      priceAtomicUsdc: 1_000,
      sourceKind: "internal-test",
      creatorKind: "internal-test",
      verifiedCreator: false,
    };
    const highYieldSource: CreatorSource = {
      ...lowYieldSource,
      id: "high-yield-agent-payments",
      title: "High Yield Agent Payments",
      creator: "High Yield Lab",
      handle: "@high",
      wallet: "0x2222222222222222222222222222222222222222",
      url: "https://example.com/high",
    };
    const yields = groundingYieldsBySource({
      queries: [],
      receipts: [
        testReceipt(lowYieldSource.id, "refunded", 1),
        testReceipt(lowYieldSource.id, "refunded", 2),
        testReceipt(lowYieldSource.id, "refunded", 3),
        testReceipt(highYieldSource.id, "local-proof", 4),
        testReceipt(highYieldSource.id, "local-proof", 5),
        testReceipt(highYieldSource.id, "local-proof", 6),
      ],
    });

    const plan = planCitationMarket(
      "How should AI agents pay creators?",
      [lowYieldSource, highYieldSource],
      1,
      1_000,
      yields,
    );

    expect(plan.selectedSources.map((source) => source.id)).toEqual([
      highYieldSource.id,
    ]);
    expect(
      plan.decisions.find(
        (decision) => decision.sourceId === highYieldSource.id,
      )?.valuePerAtomicUsdc,
    ).toBeGreaterThan(
      plan.decisions.find((decision) => decision.sourceId === lowYieldSource.id)
        ?.valuePerAtomicUsdc ?? 0,
    );
  });

  it("caps probation sources to one per deterministic answer", () => {
    const probationSources: CreatorSource[] = [
      {
        id: "probation-a",
        title: "Probation Agent Payments A",
        creator: "Probation A",
        handle: "@probationa",
        wallet: "0x1111111111111111111111111111111111111111",
        url: "https://example.com/probation-a",
        summary: "AI agents pay creators with x402 citation receipts.",
        tags: ["agents", "x402", "creators"],
        priceAtomicUsdc: 900,
        sourceKind: "external",
        creatorKind: "external",
        verifiedCreator: false,
        probation: true,
      },
      {
        id: "probation-b",
        title: "Probation Agent Payments B",
        creator: "Probation B",
        handle: "@probationb",
        wallet: "0x2222222222222222222222222222222222222222",
        url: "https://example.com/probation-b",
        summary: "AI agents pay creators with x402 citation receipts.",
        tags: ["agents", "x402", "creators"],
        priceAtomicUsdc: 950,
        sourceKind: "external",
        creatorKind: "external",
        verifiedCreator: false,
        probation: true,
      },
    ];

    const plan = planCitationMarket(
      "How should AI agents pay creators with x402?",
      probationSources,
    );

    expect(plan.selectedSources).toHaveLength(1);
    expect(plan.selectedSources[0]?.probation).toBe(true);
  });

  it("filters probation sources that hit the paid-citation cap", () => {
    const previous = process.env.TOLLGATE_PROBATION_MAX_PAID_CITATIONS;
    process.env.TOLLGATE_PROBATION_MAX_PAID_CITATIONS = "1";
    const source: CreatorSource = {
      id: "probation-cap",
      title: "Probation Cap",
      creator: "Probation Lab",
      handle: "@probation",
      wallet: "0x3333333333333333333333333333333333333333",
      url: "https://example.com/probation-cap",
      summary: "A probation source that already received one paid citation.",
      tags: ["probation"],
      priceAtomicUsdc: 1_000,
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: false,
      probation: true,
    };
    const query = createQueryRecord(
      "How should probation caps work for paid citations?",
      "2026-07-03T12:00:00.000Z",
      [source],
    );
    const receipts = createReceipts(query, []);

    try {
      const filtered = sourcesForAgent([source], {
        queries: [
          {
            ...query,
            receiptHashes: receipts.map((receipt) => receipt.receiptHash),
          },
        ],
        receipts,
      });

      expect(filtered).toHaveLength(0);
    } finally {
      if (previous === undefined) {
        delete process.env.TOLLGATE_PROBATION_MAX_PAID_CITATIONS;
      } else {
        process.env.TOLLGATE_PROBATION_MAX_PAID_CITATIONS = previous;
      }
    }
  });

  it("filters widget answers to one creator wallet", () => {
    const first: CreatorSource = {
      id: "creator-widget-a",
      title: "Creator Widget A",
      creator: "Creator A",
      handle: "@a",
      wallet: "0x1111111111111111111111111111111111111111",
      url: "https://example.com/a",
      summary: "Widget source A.",
      tags: ["widget"],
      priceAtomicUsdc: 1_000,
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: true,
    };
    const second: CreatorSource = {
      ...first,
      id: "creator-widget-b",
      title: "Creator Widget B",
      wallet: "0x2222222222222222222222222222222222222222",
      url: "https://example.com/b",
    };

    const filtered = filterSourcesForSettlement([first, second], {
      creatorWallet: first.wallet,
    });

    expect(filtered).toEqual([first]);
    expect(() =>
      filterSourcesForSettlement([first], {
        creatorWallet: "0x3333333333333333333333333333333333333333",
      }),
    ).toThrow("No sources");
  });

  it("pins a judge profile to the requested source order", () => {
    const sources = selectSources(
      "How should AI agents pay creators with x402?",
    );
    const selectedIds = sources.slice(0, 2).map((source) => source.id);
    const filtered = filterSourcesForSettlement(sources, {
      sourceIds: selectedIds,
    });

    expect(filtered.map((source) => source.id)).toEqual(selectedIds);
    expect(() =>
      filterSourcesForSettlement(sources, { sourceIds: ["missing-source"] }),
    ).toThrow("Judge demo sources are unavailable");
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

  it("records contributor splits in receipt hashes", () => {
    const query = createQueryRecord(
      "How should co-authored sources split AI citation payouts?",
      "2026-07-03T13:30:00.000Z",
    );
    query.citations = query.citations.map((citation) => ({
      ...citation,
      contributors: [
        {
          wallet: "0x8888888888888888888888888888888888888888",
          shareBps: 7_000,
        },
        {
          wallet: "0x9999999999999999999999999999999999999999",
          shareBps: 3_000,
        },
      ],
    }));

    const receipts = createReceipts(query, []);

    expect(receipts[0]?.contributors).toEqual(query.citations[0]?.contributors);
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

  it("keeps unverified escrow out of creator earnings until verification release", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-escrow-"));
    const filePath = path.join(dir, "ledger.json");
    const source: CreatorSource = {
      id: "escrowed-research",
      title: "Escrowed Research",
      creator: "Escrow Lab",
      handle: "@escrow",
      wallet: "0x7777777777777777777777777777777777777777",
      url: "https://example.com/escrowed-research",
      summary: "Research about escrowed creator payments for Tollgate tests.",
      tags: ["escrow", "payments"],
      priceAtomicUsdc: 1_400,
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: false,
    };

    try {
      const query = createQueryRecord(
        "How should escrowed payments protect unverified creators?",
        "2026-07-03T12:00:00.000Z",
        [source],
      );
      const escrowSettlement = await appendSettlement(
        query,
        {
          [source.id]: {
            settlementMode: "escrowed",
            paymentResource: "tollgate-escrow:unverified-source",
            payoutPolicy: "escrow-unverified",
          },
        },
        filePath,
      );

      expect(escrowSettlement.receipts[0]?.settlementMode).toBe("escrowed");
      expect(summarizeCreators(escrowSettlement.ledger)).toHaveLength(0);
      expect(
        getSourceEvidence(escrowSettlement.ledger, source.id)?.earnedAtomicUsdc,
      ).toBe(0);

      const verifiedSource: CreatorSource = {
        ...source,
        verifiedCreator: true,
        ownershipProof: {
          method: "wallet-signature",
          signer: source.wallet,
          signatureHash: `0x${"ab".repeat(32)}`,
          verifiedAt: "2026-07-03T12:01:00.000Z",
        },
      };
      const release = await releaseEscrowForSource(verifiedSource, {
        ledgerPath: filePath,
        enabled: false,
      });
      const releasedLedger = await readLedger(filePath);
      const releaseReceipt = releasedLedger.receipts.at(-1);

      expect(release.released).toBe(true);
      expect(release.amountAtomicUsdc).toBe(source.priceAtomicUsdc);
      expect(releaseReceipt?.payoutPolicy).toBe("escrow-release");
      expect(releaseReceipt?.releasedReceiptHashes).toEqual([
        escrowSettlement.receipts[0]?.receiptHash,
      ]);
      expect(
        getSourceEvidence(releasedLedger, source.id)?.earnedAtomicUsdc,
      ).toBe(source.priceAtomicUsdc);
      expect(verifyLedgerIntegrity(releasedLedger).ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("releases escrow for creator-claimed sources without setting verified", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-claim-escrow-"));
    const filePath = path.join(dir, "ledger.json");
    const source: CreatorSource = {
      id: "claimed-research",
      title: "Claimed Research",
      creator: "Claim Lab",
      handle: "@claim",
      wallet: "0x7777777777777777777777777777777777777777",
      url: "https://example.com/claimed-research",
      summary: "Research claimed by the registrant for escrow release.",
      tags: ["claim", "payments"],
      priceAtomicUsdc: 1_300,
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: false,
    };

    try {
      const query = createQueryRecord(
        "How should creator claims release escrow?",
        "2026-07-07T12:00:00.000Z",
        [source],
      );
      const escrowSettlement = await appendSettlement(
        query,
        {
          [source.id]: {
            settlementMode: "escrowed",
            paymentResource: "tollgate-escrow:unverified-source",
            payoutPolicy: "escrow-unverified",
          },
        },
        filePath,
      );
      const claimedSource: CreatorSource = {
        ...source,
        creatorClaimed: true,
        probation: false,
        ownershipProof: {
          method: "creator-claimed",
          verifiedAt: "2026-07-07T12:01:00.000Z",
        },
      };

      const release = await releaseEscrowForSource(claimedSource, {
        ledgerPath: filePath,
        enabled: false,
      });
      const releasedLedger = await readLedger(filePath);
      const releaseReceipt = releasedLedger.receipts.at(-1);

      expect(claimedSource.verifiedCreator).toBe(false);
      expect(release.released).toBe(true);
      expect(release.amountAtomicUsdc).toBe(source.priceAtomicUsdc);
      expect(releaseReceipt?.payoutPolicy).toBe("escrow-release");
      expect(releaseReceipt?.ownershipProof?.method).toBe("creator-claimed");
      expect(releaseReceipt?.releasedReceiptHashes).toEqual([
        escrowSettlement.receipts[0]?.receiptHash,
      ]);
      expect(release.settlement?.query.answer).toContain(
        "self-attested creator claim",
      );
      expect(verifyLedgerIntegrity(releasedLedger).ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not release escrow for wallet-signature-only sources", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-wallet-escrow-"));
    const filePath = path.join(dir, "ledger.json");
    const previousEscrow = process.env.TOLLGATE_ESCROW_UNVERIFIED;
    process.env.TOLLGATE_ESCROW_UNVERIFIED = "0";
    const source: CreatorSource = {
      id: "wallet-signed-research",
      title: "Wallet Signed Research",
      creator: "Wallet Lab",
      handle: "@wallet",
      wallet: "0x9999999999999999999999999999999999999999",
      url: "https://example.com/wallet-signed-research",
      summary: "Research with only a payout-wallet signature.",
      tags: ["wallet", "payments"],
      priceAtomicUsdc: 1_200,
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: false,
      probation: true,
      ownershipProof: {
        method: "wallet-signature",
        signer: "0x9999999999999999999999999999999999999999",
        signatureHash: `0x${"cd".repeat(32)}`,
        verifiedAt: "2026-07-07T12:01:00.000Z",
      },
    };

    try {
      const query = createQueryRecord(
        "How should wallet-signature escrow stay held?",
        "2026-07-07T12:00:00.000Z",
        [source],
      );
      await appendSettlement(
        query,
        {
          [source.id]: {
            settlementMode: "escrowed",
            paymentResource: "tollgate-escrow:unverified-source",
            payoutPolicy: "escrow-unverified",
          },
        },
        filePath,
      );

      const release = await releaseEscrowForSource(source, {
        ledgerPath: filePath,
        enabled: false,
      });
      const ledger = await readLedger(filePath);

      expect(release.released).toBe(false);
      expect(release.amountAtomicUsdc).toBe(0);
      expect(
        ledger.receipts.some(
          (receipt) => receipt.payoutPolicy === "escrow-release",
        ),
      ).toBe(false);
      expect(verifyLedgerIntegrity(ledger).ok).toBe(true);
    } finally {
      if (previousEscrow === undefined) {
        delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
      } else {
        process.env.TOLLGATE_ESCROW_UNVERIFIED = previousEscrow;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("releases escrow exactly once under concurrent verify calls", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-escrow-race-"));
    const filePath = path.join(dir, "ledger.json");
    const source: CreatorSource = {
      id: "raced-research",
      title: "Raced Research",
      creator: "Race Lab",
      handle: "@race",
      wallet: "0x8888888888888888888888888888888888888888",
      url: "https://example.com/raced-research",
      summary: "Research used to prove escrow releases are serialized.",
      tags: ["escrow", "race"],
      priceAtomicUsdc: 1_100,
      sourceKind: "external",
      creatorKind: "external",
      verifiedCreator: false,
    };

    try {
      const query = createQueryRecord(
        "How does Tollgate serialize concurrent escrow releases?",
        "2026-07-03T13:00:00.000Z",
        [source],
      );
      await appendSettlement(
        query,
        {
          [source.id]: {
            settlementMode: "escrowed",
            paymentResource: "tollgate-escrow:unverified-source",
            payoutPolicy: "escrow-unverified",
          },
        },
        filePath,
      );

      const verifiedSource: CreatorSource = {
        ...source,
        verifiedCreator: true,
      };
      const [first, second] = await Promise.all([
        releaseEscrowForSource(verifiedSource, {
          ledgerPath: filePath,
          enabled: false,
        }),
        releaseEscrowForSource(verifiedSource, {
          ledgerPath: filePath,
          enabled: false,
        }),
      ]);

      const releasedCount = [first, second].filter(
        (result) => result.released,
      ).length;
      expect(releasedCount).toBe(1);

      const ledger = await readLedger(filePath);
      const releaseReceipts = ledger.receipts.filter(
        (receipt) => receipt.payoutPolicy === "escrow-release",
      );
      expect(releaseReceipts).toHaveLength(1);
      expect(verifyLedgerIntegrity(ledger).ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  it("stores wallet-signature proof without granting source verification", async () => {
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
      const result = await withRegistrationFetchDisabled(() =>
        appendSource(
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
        ),
      );

      expect(result.source.verifiedCreator).toBe(false);
      expect(result.source.probation).toBe(true);
      expect(result.source.ownershipProof?.method).toBe("wallet-signature");
      expect(result.source.ownershipProof?.signer).toBe(account.address);
      expect(result.source.ownershipProof?.signatureHash).toMatch(
        /^0x[0-9a-f]{64}$/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects custodial source registration when W3S is not configured", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-sources-"));
    const filePath = path.join(dir, "sources.json");
    const previousKey = process.env.CIRCLE_API_KEY;
    const previousSecret = process.env.CIRCLE_ENTITY_SECRET;
    const previousSet = process.env.CIRCLE_WALLET_SET_ID;
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    delete process.env.CIRCLE_WALLET_SET_ID;

    try {
      await expect(
        withRegistrationFetchDisabled(() =>
          appendSource(
            {
              title: "Custodial Research Feed",
              creator: "Custody Lab",
              handle: "@custody",
              url: "https://example.com/custody",
              summary: "Custodial onboarding should fail clearly without W3S.",
              tags: ["custody"],
              priceAtomicUsdc: 2500,
            },
            filePath,
          ),
        ),
      ).rejects.toThrow("custodial onboarding not enabled");
    } finally {
      if (previousKey !== undefined) process.env.CIRCLE_API_KEY = previousKey;
      if (previousSecret !== undefined) {
        process.env.CIRCLE_ENTITY_SECRET = previousSecret;
      }
      if (previousSet !== undefined) {
        process.env.CIRCLE_WALLET_SET_ID = previousSet;
      }
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("registers a custodial source with an injected W3S mint", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-sources-"));
    const filePath = path.join(dir, "sources.json");
    const previousKey = process.env.CIRCLE_API_KEY;
    const previousSecret = process.env.CIRCLE_ENTITY_SECRET;
    const previousSet = process.env.CIRCLE_WALLET_SET_ID;
    process.env.CIRCLE_API_KEY = "test";
    process.env.CIRCLE_ENTITY_SECRET = "ab".repeat(32);
    process.env.CIRCLE_WALLET_SET_ID = "wallet-set";

    try {
      const result = await withRegistrationFetchDisabled(() =>
        appendSource(
          {
            title: "Custodial Research Feed",
            creator: "Custody Lab",
            handle: "@custody",
            url: "https://example.com/custody",
            summary: "Custodial onboarding stores a minted payout wallet.",
            tags: ["custody"],
            priceAtomicUsdc: 2500,
          },
          filePath,
          async () => ({
            id: "wallet-id",
            address: "0x9999999999999999999999999999999999999999",
            blockchain: "ARC-TESTNET",
            state: "LIVE",
          }),
        ),
      );

      expect(result.source.wallet).toBe(
        "0x9999999999999999999999999999999999999999",
      );
      expect(result.source.custody).toBe("circle-w3s");
      expect(result.source.walletId).toBe("wallet-id");
    } finally {
      if (previousKey === undefined) {
        delete process.env.CIRCLE_API_KEY;
      } else {
        process.env.CIRCLE_API_KEY = previousKey;
      }
      if (previousSecret === undefined) {
        delete process.env.CIRCLE_ENTITY_SECRET;
      } else {
        process.env.CIRCLE_ENTITY_SECRET = previousSecret;
      }
      if (previousSet === undefined) {
        delete process.env.CIRCLE_WALLET_SET_ID;
      } else {
        process.env.CIRCLE_WALLET_SET_ID = previousSet;
      }
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

  it("accepts legacy x402 source access receipt hashes with undefined transaction", () => {
    const receiptHash = [
      "0xa6259069d4674cc9",
      "efd4dd5854151da7",
      "88ed9b922b918c34",
      "59ce2d26dfb75b00",
    ].join("");
    const query: QueryRecord = {
      id: "legacy-source-query",
      question: "Paid source access: Circle Gateway nano x402 source",
      answer: "Legacy source-access proof.",
      queryHash: "legacy-query-hash",
      answerHash: "legacy-answer-hash",
      totalAtomicUsdc: 2_400,
      citations: [],
      receiptHashes: [receiptHash],
      createdAt: "2026-06-16T14:00:03.396Z",
    };
    const receipt: PaymentReceipt = {
      id: receiptHash.slice(0, 18),
      queryId: query.id,
      sourceId: "circle-gateway-nano",
      creator: "Gateway Lab",
      wallet: "0x3333333333333333333333333333333333333333",
      amountAtomicUsdc: 2_400,
      settlementMode: "x402-verified",
      payer: "0xb48169146BF764161B6DFee09b58E8dBE846cb28",
      paymentResource: "/api/sources/circle-gateway-nano",
      previousHash: ZERO_HASH,
      receiptHash,
      createdAt: query.createdAt,
    };

    const verification = verifyLedgerIntegrity({
      queries: [query],
      receipts: [receipt],
    });

    expect(verification.ok).toBe(true);
  });

  it("accepts legacy reader payment hashes with undefined transaction", () => {
    const paymentHash = [
      "0xb64d83a7a199defd",
      "1da999f1a5539005",
      "24e81e6413f7158f",
      "0ffa521c019660ed",
    ].join("");
    const query: QueryRecord = {
      id: "legacy-paid-query",
      question: "How does Tollgate prove reader-paid answers on Arc?",
      answer: "Legacy paid-query proof.",
      queryHash: "legacy-paid-query-hash",
      answerHash: "legacy-paid-answer-hash",
      totalAtomicUsdc: 0,
      citations: [],
      receiptHashes: [],
      readerPayment: {
        amountAtomicUsdc: 1_000,
        settlementMode: "x402-verified",
        payTo: "0x22949cA9A470181c66a034E81a743E2518579E95",
        payer: "0x9E210daeA5b622D1BBCa3389Ac8C6e83fa960A06",
        paymentResource: "/api/paid-query",
        paymentHash,
      },
      createdAt: "2026-06-16T14:00:03.396Z",
    };

    const verification = verifyLedgerIntegrity({
      queries: [query],
      receipts: [],
    });

    expect(verification.ok).toBe(true);
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
      expect(verification.latestHash).toBe(ledger.receipts.at(-1)?.receiptHash);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads and appends against SQLite when ledger.db exists", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lepton-ledger-db-"));
    const filePath = path.join(dir, "ledger.json");
    const dbPath = path.join(dir, "ledger.db");
    try {
      await writeFile(dbPath, "");
      const query = createQueryRecord(
        "How does SQLite preserve Tollgate receipt chains?",
        "2026-07-03T13:00:00.000Z",
      );

      await appendSettlement(query, {}, filePath);
      const ledger = await readLedger(filePath);
      const verification = verifyLedgerIntegrity(ledger);

      expect(ledger.queries).toHaveLength(1);
      expect(ledger.receipts).toHaveLength(query.citations.length);
      expect(verification.ok).toBe(true);
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
