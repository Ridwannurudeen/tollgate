import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryRecord } from "./engine";
import {
  PaidQueryAgentError,
  settlePaidQuestion,
  settleQuestion,
} from "./settlement";
import type { CreatorSource, QueryPaymentEvidence, QueryRecord } from "./types";

const mocks = vi.hoisted(() => ({
  agentOptionsForServerMode: vi.fn(),
  agentServerModeFromEnv: vi.fn(),
  anchorUseIntent: vi.fn(),
  appendSettlement: vi.fn(),
  assertSpendWithinIntent: vi.fn(),
  attachTrackRecordEvidence: vi.fn(),
  buildUseIntent: vi.fn(),
  createAgentQueryRecord: vi.fn(),
  groundingYieldsBySource: vi.fn(),
  publishTrackRecordForAnswer: vi.fn(),
  readLedger: vi.fn(),
  readSources: vi.fn(),
  refundReaderPayment: vi.fn(),
  routeCitationPayments: vi.fn(),
  signUseIntent: vi.fn(),
  useIntentEnabled: vi.fn(),
  useIntentRecord: vi.fn(),
}));

vi.mock("./agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent")>();
  return {
    ...actual,
    agentOptionsForServerMode: mocks.agentOptionsForServerMode,
    agentServerModeFromEnv: mocks.agentServerModeFromEnv,
    createAgentQueryRecord: mocks.createAgentQueryRecord,
  };
});

vi.mock("./catalog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog")>();
  return { ...actual, readSources: mocks.readSources };
});

vi.mock("./fee-router", () => ({
  refundReaderPayment: mocks.refundReaderPayment,
  routeCitationPayments: mocks.routeCitationPayments,
}));

vi.mock("./grounding-yield", () => ({
  groundingYieldsBySource: mocks.groundingYieldsBySource,
}));

vi.mock("./ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ledger")>();
  return {
    ...actual,
    appendSettlement: mocks.appendSettlement,
    attachTrackRecordEvidence: mocks.attachTrackRecordEvidence,
    readLedger: mocks.readLedger,
  };
});

vi.mock("./track-record", () => ({
  publishTrackRecordForAnswer: mocks.publishTrackRecordForAnswer,
}));

vi.mock("./use-intent", () => ({
  anchorUseIntent: mocks.anchorUseIntent,
  assertSpendWithinIntent: mocks.assertSpendWithinIntent,
  buildUseIntent: mocks.buildUseIntent,
  signUseIntent: mocks.signUseIntent,
  useIntentEnabled: mocks.useIntentEnabled,
  useIntentRecord: mocks.useIntentRecord,
}));

const QUESTION = "How should agents anchor intent before paying creators?";
const SOURCE: CreatorSource = {
  id: "anchor-order-source",
  title: "Anchor Order Evidence",
  creator: "Order Lab",
  handle: "@order",
  wallet: "0x1111111111111111111111111111111111111111",
  url: "https://example.com/anchor-order",
  summary: "Agents anchor signed use intent before creator settlement.",
  tags: ["agents", "payments"],
  priceAtomicUsdc: 1_000,
  sourceKind: "internal-test",
  creatorKind: "internal-test",
  verifiedCreator: true,
};
const ANCHOR_TX = `0x${"a".repeat(64)}` as const;
const SIGNATURE = `0x${"b".repeat(130)}` as const;
const READER_PAYMENT: Omit<QueryPaymentEvidence, "paymentHash"> = {
  amountAtomicUsdc: 10_000,
  settlementMode: "x402-settled" as const,
  payTo: "0x2222222222222222222222222222222222222222",
  payer: "0x3333333333333333333333333333333333333333",
  transaction: `0x${"c".repeat(64)}`,
  paymentResource: "/api/paid-query",
};
const USE_INTENT_RECORD = {
  digest: `0x${"1".repeat(64)}` as const,
  signature: SIGNATURE,
  chainId: 5_042_002,
  registryAddress: "0x4444444444444444444444444444444444444444" as const,
  nonce: "7",
  anchorTx: ANCHOR_TX,
  maxSpendAtomicUsdc: "1000",
  expiry: "1900000000",
  candidateSetRoot: `0x${"2".repeat(64)}` as const,
  selectedSourcesRoot: `0x${"3".repeat(64)}` as const,
  decisionTraceHash: `0x${"4".repeat(64)}` as const,
  claimSupportRoot: `0x${"5".repeat(64)}` as const,
};
const ENV_NAMES = [
  "LEPTONWEB_CONTRIBUTION_PAYOUTS",
  "LEPTONWEB_FEE_ROUTER_ENABLED",
];
let previousEnv: Map<string, string | undefined>;

beforeEach(() => {
  previousEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  delete process.env.LEPTONWEB_CONTRIBUTION_PAYOUTS;
  process.env.LEPTONWEB_FEE_ROUTER_ENABLED = "1";
  vi.resetAllMocks();
  mocks.agentOptionsForServerMode.mockReturnValue({});
  mocks.agentServerModeFromEnv.mockReturnValue("production");
  mocks.anchorUseIntent.mockResolvedValue(ANCHOR_TX);
  mocks.appendSettlement.mockImplementation(async (query: QueryRecord) => ({
    query,
    receipts: [],
    ledger: { queries: [query], receipts: [] },
  }));
  mocks.buildUseIntent.mockReturnValue({
    intent: { maxSpendAtomicUsdc: 1_000n },
    digest: USE_INTENT_RECORD.digest,
    plannedSpendAtomicUsdc: 1_000,
    registryAddress: USE_INTENT_RECORD.registryAddress,
    chainId: USE_INTENT_RECORD.chainId,
  });
  mocks.createAgentQueryRecord.mockImplementation(
    async (
      question: string,
      createdAt: string,
      sources: CreatorSource[],
      readerPayment?: QueryPaymentEvidence,
    ) => createQueryRecord(question, createdAt, sources, readerPayment),
  );
  mocks.groundingYieldsBySource.mockReturnValue({});
  mocks.publishTrackRecordForAnswer.mockResolvedValue(null);
  mocks.readLedger.mockResolvedValue({ queries: [], receipts: [] });
  mocks.readSources.mockResolvedValue([SOURCE]);
  mocks.refundReaderPayment.mockResolvedValue(null);
  mocks.routeCitationPayments.mockResolvedValue({});
  mocks.signUseIntent.mockResolvedValue(SIGNATURE);
  mocks.useIntentEnabled.mockReturnValue(true);
  mocks.useIntentRecord.mockReturnValue(USE_INTENT_RECORD);
});

afterEach(() => {
  for (const [name, value] of previousEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("anchor-before-payment settlement ordering", () => {
  it("does not route a free query when anchoring fails", async () => {
    mocks.anchorUseIntent.mockRejectedValue(new Error("anchor reverted"));

    await expect(settleQuestion(QUESTION)).rejects.toThrow("anchor reverted");
    expect(mocks.routeCitationPayments).not.toHaveBeenCalled();
  });

  it("anchors a free query before routing it", async () => {
    const events: string[] = [];
    mocks.anchorUseIntent.mockImplementation(async () => {
      events.push("anchor");
      return ANCHOR_TX;
    });
    mocks.routeCitationPayments.mockImplementation(
      async (query: QueryRecord) => {
        events.push("payment");
        expect(query.useIntent?.anchorTx).toBe(ANCHOR_TX);
        return {};
      },
    );

    await settleQuestion(QUESTION);

    expect(events).toEqual(["anchor", "payment"]);
  });

  it("does not route a paid query when anchoring fails", async () => {
    mocks.anchorUseIntent.mockRejectedValue(new Error("anchor reverted"));

    await expect(
      settlePaidQuestion(QUESTION, READER_PAYMENT),
    ).rejects.toMatchObject({
      stage: "use-intent-anchoring",
    });
    expect(mocks.routeCitationPayments).not.toHaveBeenCalled();
  });

  it("preserves the anchor when post-anchor routing fails", async () => {
    const events: string[] = [];
    mocks.anchorUseIntent.mockImplementation(async () => {
      events.push("anchor");
      return ANCHOR_TX;
    });
    mocks.routeCitationPayments.mockImplementation(
      async (query: QueryRecord) => {
        events.push("payment");
        expect(query.useIntent?.anchorTx).toBe(ANCHOR_TX);
        throw new Error("second creator payout failed");
      },
    );

    let caught: unknown;
    try {
      await settlePaidQuestion(QUESTION, READER_PAYMENT);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PaidQueryAgentError);
    expect(caught).toMatchObject({
      stage: "fee-router-settlement-post-anchor",
      query: { useIntent: { anchorTx: ANCHOR_TX } },
    });
    expect(events).toEqual(["anchor", "payment"]);
  });

  it("keeps the legacy routing stage when anchoring is disabled", async () => {
    mocks.useIntentEnabled.mockReturnValue(false);
    mocks.routeCitationPayments.mockRejectedValue(
      new Error("creator payout failed"),
    );

    let caught: unknown;
    try {
      await settlePaidQuestion(QUESTION, READER_PAYMENT);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PaidQueryAgentError);
    if (!(caught instanceof PaidQueryAgentError)) {
      throw new Error("expected PaidQueryAgentError");
    }
    expect(caught.stage).toBe("fee-router-settlement");
    expect(caught.query?.useIntent).toBeUndefined();
    expect(mocks.anchorUseIntent).not.toHaveBeenCalled();
  });
});
