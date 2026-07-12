import { readSources } from "./catalog";
import {
  AgentPlanningError,
  agentOptionsForServerMode,
  agentServerModeFromEnv,
  completeChat,
  createAgentQueryRecord,
  llmConfigFromEnv,
  type AgentServerMode,
} from "./agent";
import {
  claimSupportRoot,
  extractClaims,
  removeUnsupportedClaims,
  scoreContribution,
  scoreContributionLeaveOneOut,
  verifyClaims,
  type ClaimLlm,
} from "./contribution";
import { actorClassForPayer } from "./actor-class";
import { refundReaderPayment, routeCitationPayments } from "./fee-router";
import { groundingYieldsBySource } from "./grounding-yield";
import { sha256Hex } from "./hash";
import {
  appendSettlement,
  attachTrackRecordEvidence,
  readLedger,
} from "./ledger";
import { publishTrackRecordForAnswer } from "./track-record";
import {
  anchorUseIntent,
  assertSpendWithinIntent,
  buildUseIntent,
  signUseIntent,
  useIntentEnabled,
  useIntentRecord,
  type BuiltUseIntent,
} from "./use-intent";
import type {
  CreatorSource,
  Ledger,
  QueryPaymentEvidence,
  QueryRecord,
  SettlementResult,
} from "./types";

const MAX_QUESTION_LENGTH = 280;
const DEFAULT_PROBATION_DISTINCT_QUERY_THRESHOLD = 3;
const DEFAULT_PROBATION_MAX_PAID_CITATIONS = 3;

type SettleOptions = {
  creatorWallet?: string;
  sourceIds?: string[];
};

type PreparedUseIntent = {
  built: BuiltUseIntent;
  signature: `0x${string}`;
};

export class PaidQueryAgentError extends Error {
  readonly stage: string;
  readonly readerPayment: QueryPaymentEvidence;
  readonly query?: QueryRecord;
  readonly priorFailure?: { stage: string; message: string };

  constructor(
    cause: unknown,
    readerPayment: QueryPaymentEvidence,
    stage?: string,
    query?: QueryRecord,
    priorFailure?: { stage: string; message: string },
  ) {
    const message =
      cause instanceof Error ? cause.message : "Paid query agent failed.";
    super(message);
    this.name = "PaidQueryAgentError";
    this.stage =
      stage ??
      (cause instanceof AgentPlanningError ? cause.stage : "agent-planning");
    this.readerPayment = readerPayment;
    this.query = query;
    this.priorFailure = priorFailure;
  }
}

export function contributionPayoutsEnabled(
  serverMode: AgentServerMode,
): boolean {
  return (
    process.env.LEPTONWEB_CONTRIBUTION_PAYOUTS === "1" ||
    (serverMode === "judge-strict" &&
      process.env.LEPTONWEB_CONTRIBUTION_PAYOUTS !== "0")
  );
}

export function leaveOneOutContributionEnabled(
  serverMode: AgentServerMode,
  purchasedSourceCount: number,
): boolean {
  if (!contributionPayoutsEnabled(serverMode)) return false;
  if (purchasedSourceCount < 1 || purchasedSourceCount > 3) return false;
  return (
    process.env.LEPTONWEB_LEAVE_ONE_OUT_CONTRIBUTION === "1" ||
    (serverMode === "judge-strict" &&
      process.env.LEPTONWEB_LEAVE_ONE_OUT_CONTRIBUTION !== "0")
  );
}

export async function applyContributionProof(
  query: QueryRecord,
  sources: CreatorSource[],
  serverMode: AgentServerMode,
): Promise<QueryRecord> {
  if (!contributionPayoutsEnabled(serverMode)) return query;
  const plannerConfig = llmConfigFromEnv();
  if (!plannerConfig) {
    throw new Error(
      "Contribution payouts require a configured LLM planner for claim verification.",
    );
  }
  const verifierConfig = {
    ...plannerConfig,
    model:
      process.env.LEPTONWEB_VERIFIER_MODEL?.trim() || plannerConfig.model,
  };
  const plannerLlm: ClaimLlm = (messages) =>
    completeChat(messages, plannerConfig);
  const verifierLlm: ClaimLlm = (messages) =>
    completeChat(messages, verifierConfig);
  const purchasedSourceIds = new Set(
    query.citations.map((citation) => citation.sourceId),
  );
  const purchasedSources = sources.filter((source) =>
    purchasedSourceIds.has(source.id),
  );
  const claims = await extractClaims(query.answer, plannerLlm);
  const claimSupport = await verifyClaims(
    claims,
    purchasedSources,
    verifierLlm,
  );
  if (
    serverMode === "judge-strict" &&
    claimSupport.length > 0 &&
    claimSupport.every((support) => support.status === "unable-to-verify")
  ) {
    throw new Error(
      "Judge-strict contribution verifier could not verify any claim.",
    );
  }
  const fallbackAmounts = Object.fromEntries(
    query.citations
      .filter((citation) => citation.payoutPolicy !== "refund-unused")
      .map((citation) => [citation.sourceId, citation.amountAtomicUsdc]),
  );
  const poolAtomicUsdc = Object.values(fallbackAmounts).reduce(
    (sum, amount) => sum + amount,
    0,
  );
  let contributionProof: QueryRecord["contributionProof"];
  let contributionScores: ReturnType<typeof scoreContribution>;
  if (leaveOneOutContributionEnabled(serverMode, purchasedSources.length)) {
    const leaveOneOut = await scoreContributionLeaveOneOut(
      claims,
      purchasedSources,
      verifierLlm,
      claimSupport,
      poolAtomicUsdc,
      fallbackAmounts,
    );
    contributionScores = leaveOneOut.contributionScores;
    contributionProof = leaveOneOut.contributionProof;
  } else {
    contributionScores = scoreContribution(
      claimSupport,
      poolAtomicUsdc,
      fallbackAmounts,
    );
  }
  const scoreBySourceId = new Map(
    contributionScores.map((score) => [score.sourceId, score]),
  );
  const citations = query.citations.map((citation) => {
    const score = scoreBySourceId.get(citation.sourceId);
    if (!score || citation.payoutPolicy === "refund-unused") return citation;
    if (!score.fallback && score.rewardAtomicUsdc === 0) {
      return {
        ...citation,
        payoutPolicy: "refund-unused" as const,
        payoutAtomicUsdc: undefined,
      };
    }
    return { ...citation, payoutAtomicUsdc: score.rewardAtomicUsdc };
  });
  const sanitizedAnswer = removeUnsupportedClaims(query.answer, claimSupport);
  const supportRoot = claimSupportRoot(claimSupport, contributionProof);
  const refundSummary = {
    boughtCount: citations.length,
    citedCount: citations.filter(
      (citation) => citation.payoutPolicy !== "refund-unused",
    ).length,
    refundedCount: citations.filter(
      (citation) => citation.payoutPolicy === "refund-unused",
    ).length,
    refundedAtomicUsdc: citations
      .filter((citation) => citation.payoutPolicy === "refund-unused")
      .reduce((sum, citation) => sum + citation.amountAtomicUsdc, 0),
  };
  const queryHash = sha256Hex({
    question: query.question,
    citations,
    sourceDecisions: query.sourceDecisions,
    agentBudget: query.agentBudget,
    readerPaymentHash: query.readerPayment?.paymentHash,
    claimSupportRoot: supportRoot,
  });
  const answerHash = sha256Hex({
    answer: sanitizedAnswer,
    citations,
    sourceDecisions: query.sourceDecisions,
    agentBudget: query.agentBudget,
    traceHash: query.traceHash,
    readerPaymentHash: query.readerPayment?.paymentHash,
    externalAssists: query.externalAssists,
    claimSupportRoot: supportRoot,
    contributionScores,
  });
  return {
    ...query,
    id: sha256Hex({
      createdAt: query.createdAt,
      question: query.question,
      queryHash,
    }).slice(0, 18),
    answer: sanitizedAnswer,
    queryHash,
    answerHash,
    citations,
    claimSupport,
    contributionScores,
    ...(contributionProof ? { contributionProof } : {}),
    claimSupportRoot: supportRoot,
    refundSummary,
  };
}

export function normalizeQuestion(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

export function validateQuestion(question: string): string {
  const normalized = normalizeQuestion(question);
  if (normalized.length < 8) {
    throw new Error("Ask a source-backed question with at least 8 characters.");
  }
  if (normalized.length > MAX_QUESTION_LENGTH) {
    throw new Error(
      `Keep the question under ${MAX_QUESTION_LENGTH} characters.`,
    );
  }
  return normalized;
}

export async function settleQuestion(
  question: string,
  options: SettleOptions = {},
): Promise<SettlementResult> {
  const normalized = validateQuestion(question);
  const createdAt = new Date().toISOString();
  const [sources, ledger] = await Promise.all([readSources(), readLedger()]);
  const agentSources = filterSourcesForSettlement(
    sourcesForAgent(sources, ledger),
    options,
  );
  const agent = agentOptionsForLedger(ledger);
  const plannedQuery = await createAgentQueryRecord(
    normalized,
    createdAt,
    agentSources,
    undefined,
    agent.options,
  );
  const query = await applyContributionProof(
    plannedQuery,
    agentSources,
    agent.serverMode,
  );
  const preparedUseIntent = await prepareUseIntent(query);
  const anchoredQuery = await anchorPreparedUseIntent(
    query,
    preparedUseIntent,
  );
  const receiptEvidence = await routeCitationPayments(anchoredQuery);
  return settleAndAnchorTrackRecord(anchoredQuery, receiptEvidence);
}

export function createQueryPaymentEvidence(
  payment: Omit<QueryPaymentEvidence, "paymentHash">,
): QueryPaymentEvidence {
  const operatorWallet = process.env.CIRCLE_PAYER_ADDRESS;
  const actorClass =
    payment.actorClass ??
    (operatorWallet &&
    /^0x[0-9a-fA-F]{40}$/.test(operatorWallet) &&
    payment.payer?.toLowerCase() === operatorWallet.toLowerCase()
      ? "operator"
      : actorClassForPayer(payment.payer));
  const payload: Omit<
    QueryPaymentEvidence,
    "paymentHash" | "actorClass" | "refund" | "refundFailure"
  > = {
    amountAtomicUsdc: payment.amountAtomicUsdc,
    settlementMode: payment.settlementMode,
    payTo: payment.payTo,
    paymentResource: payment.paymentResource,
  };
  if (payment.payer !== undefined) payload.payer = payment.payer;
  if (payment.transaction !== undefined) {
    payload.transaction = payment.transaction;
  }
  return {
    ...payload,
    actorClass,
    paymentHash: sha256Hex(payload),
  };
}

export async function settlePaidQuestion(
  question: string,
  payment: Omit<QueryPaymentEvidence, "paymentHash">,
  options: SettleOptions = {},
): Promise<SettlementResult> {
  const normalized = validateQuestion(question);
  const createdAt = new Date().toISOString();
  const [sources, ledger] = await Promise.all([readSources(), readLedger()]);
  const agentSources = filterSourcesForSettlement(
    sourcesForAgent(sources, ledger),
    options,
  );
  const readerPayment = createQueryPaymentEvidence(payment);
  const agent = agentOptionsForLedger(ledger);
  let plannedQuery: Awaited<ReturnType<typeof createAgentQueryRecord>>;
  try {
    plannedQuery = await createAgentQueryRecord(
      normalized,
      createdAt,
      agentSources,
      readerPayment,
      agent.options,
    );
  } catch (error) {
    if (
      agent.serverMode !== "judge-strict" &&
      !contributionPayoutsEnabled(agent.serverMode)
    ) {
      throw error;
    }
    const stage =
      error instanceof AgentPlanningError
        ? error.stage
        : error instanceof Error &&
            error.message ===
              "Judge-strict mode requires a configured LLM planner."
          ? "configuration"
          : "agent-planning";
    return refundFailedPaidQuery(
      error,
      readerPayment,
      "judge-strict-planner-failure",
      stage,
    );
  }

  let query: Awaited<ReturnType<typeof createAgentQueryRecord>>;
  try {
    query = await applyContributionProof(
      plannedQuery,
      agentSources,
      agent.serverMode,
    );
  } catch (error) {
    if (
      agent.serverMode !== "judge-strict" &&
      !contributionPayoutsEnabled(agent.serverMode)
    ) {
      throw error;
    }
    return refundFailedPaidQuery(
      error,
      readerPayment,
      "judge-strict-planner-failure",
      "claim-verification",
      plannedQuery,
    );
  }
  if (
    query.citations.length === 0 &&
    query.readerPayment?.payer &&
    /^0x[0-9a-fA-F]{40}$/.test(query.readerPayment.payer) &&
    query.readerPayment.amountAtomicUsdc > 0
  ) {
    try {
      query.readerPayment = await attachReaderRefund(
        query.readerPayment,
        "no-answer",
        agent.serverMode === "judge-strict",
      );
    } catch (error) {
      throw new PaidQueryAgentError(
        error,
        query.readerPayment,
        "reader-refund",
        query,
        { stage: "no-answer", message: "No source-backed answer was produced." },
      );
    }
  }
  let preparedUseIntent: PreparedUseIntent | null;
  try {
    preparedUseIntent = await prepareUseIntent(query);
  } catch (error) {
    return refundFailedPaidQuery(
      error,
      query.readerPayment ?? readerPayment,
      "use-intent-preparation-failure",
      "use-intent-signing",
      query,
    );
  }
  let anchoredQuery: QueryRecord;
  try {
    anchoredQuery = await anchorPreparedUseIntent(query, preparedUseIntent);
  } catch (error) {
    throw new PaidQueryAgentError(
      error,
      query.readerPayment ?? readerPayment,
      "use-intent-anchoring",
      query,
    );
  }
  let receiptEvidence: Awaited<ReturnType<typeof routeCitationPayments>>;
  try {
    receiptEvidence = await routeCitationPayments(anchoredQuery);
  } catch (error) {
    throw new PaidQueryAgentError(
      error,
      anchoredQuery.readerPayment ?? readerPayment,
      preparedUseIntent
        ? "fee-router-settlement-post-anchor"
        : "fee-router-settlement",
      anchoredQuery,
    );
  }
  try {
    return await settleAndAnchorTrackRecord(anchoredQuery, receiptEvidence);
  } catch (error) {
    throw new PaidQueryAgentError(
      error,
      anchoredQuery.readerPayment ?? readerPayment,
      "ledger-or-track-record",
      anchoredQuery,
    );
  }
}

export function filterSourcesForSettlement(
  sources: CreatorSource[],
  options: SettleOptions,
): CreatorSource[] {
  let filtered = sources;
  if (options.sourceIds) {
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const missing = options.sourceIds.filter((sourceId) => !sourceById.has(sourceId));
    if (missing.length > 0) {
      throw new Error(`Judge demo sources are unavailable: ${missing.join(", ")}.`);
    }
    filtered = options.sourceIds.map((sourceId) => sourceById.get(sourceId)!);
  }
  if (!options.creatorWallet) return filtered;
  const creatorWallet = options.creatorWallet.toLowerCase();
  filtered = filtered.filter(
    (source) => source.wallet.toLowerCase() === creatorWallet,
  );
  if (filtered.length === 0) {
    throw new Error("No sources are registered for that creator wallet.");
  }
  return filtered;
}

function envPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function prepareUseIntent(
  query: QueryRecord,
): Promise<PreparedUseIntent | null> {
  if (!useIntentEnabled()) return null;
  if (process.env.LEPTONWEB_FEE_ROUTER_ENABLED !== "1") {
    throw new Error(
      "Use-intent anchoring requires LEPTONWEB_FEE_ROUTER_ENABLED=1.",
    );
  }
  const built = buildUseIntent(query);
  assertSpendWithinIntent(built.intent, built.plannedSpendAtomicUsdc);
  const signature = await signUseIntent(built.intent, {
    chainId: built.chainId,
    registryAddress: built.registryAddress,
  });
  return { built, signature };
}

async function anchorPreparedUseIntent(
  query: QueryRecord,
  prepared: PreparedUseIntent | null,
): Promise<QueryRecord> {
  if (!prepared) return query;
  const anchorTx = await anchorUseIntent(prepared.built, prepared.signature);
  return {
    ...query,
    useIntent: useIntentRecord(prepared.built, prepared.signature, anchorTx),
  };
}

function agentOptionsForLedger(ledger: Ledger) {
  const serverMode = agentServerModeFromEnv();
  return {
    serverMode,
    options: {
      ...agentOptionsForServerMode(serverMode),
      groundingYields: groundingYieldsBySource(ledger),
    },
  };
}

async function attachReaderRefund(
  payment: QueryPaymentEvidence,
  reason: string,
  required = false,
): Promise<QueryPaymentEvidence> {
  if (
    !payment.payer ||
    !/^0x[0-9a-fA-F]{40}$/.test(payment.payer) ||
    payment.amountAtomicUsdc <= 0
  ) {
    return payment;
  }
  let refundTx: Awaited<ReturnType<typeof refundReaderPayment>>;
  try {
    refundTx = await refundReaderPayment(
      payment.payer as `0x${string}`,
      payment.amountAtomicUsdc,
    );
  } catch (error) {
    if (required) throw error;
    return {
      ...payment,
      refundFailure: {
        reason,
        message:
          error instanceof Error
            ? error.message
            : "Reader refund settlement failed.",
      },
    };
  }
  if (!refundTx) {
    if (required) {
      throw new Error("Reader refund could not be settled on-chain.");
    }
    return {
      ...payment,
      refundFailure: {
        reason,
        message: "Reader refund is not configured or funded.",
      },
    };
  }
  return {
    ...payment,
    refund: {
      amountAtomicUsdc: payment.amountAtomicUsdc,
      transaction: refundTx,
      reason,
    },
  };
}

async function refundFailedPaidQuery(
  cause: unknown,
  payment: QueryPaymentEvidence,
  reason: string,
  stage: string,
  query?: QueryRecord,
): Promise<never> {
  try {
    const refundedPayment = await attachReaderRefund(payment, reason, true);
    throw new PaidQueryAgentError(cause, refundedPayment, stage, query);
  } catch (refundError) {
    if (refundError instanceof PaidQueryAgentError) throw refundError;
    throw new PaidQueryAgentError(
      refundError,
      payment,
      "reader-refund",
      query,
      {
        stage,
        message:
          cause instanceof Error ? cause.message : "Paid query agent failed.",
      },
    );
  }
}

function sourcePaidQueryCount(ledger: Ledger, sourceId: string): number {
  return new Set(
    ledger.receipts
      .filter(
        (receipt) =>
          receipt.sourceId === sourceId &&
          receipt.settlementMode !== "escrowed" &&
          receipt.settlementMode !== "refunded",
      )
      .map((receipt) => receipt.queryId),
  ).size;
}

export function sourcesForAgent(
  sources: CreatorSource[],
  ledger: Ledger,
): CreatorSource[] {
  const matureAfter = envPositiveInteger(
    "TOLLGATE_PROBATION_DISTINCT_QUERIES",
    DEFAULT_PROBATION_DISTINCT_QUERY_THRESHOLD,
  );
  const maxProbationCitations = envPositiveInteger(
    "TOLLGATE_PROBATION_MAX_PAID_CITATIONS",
    DEFAULT_PROBATION_MAX_PAID_CITATIONS,
  );

  return sources
    .map((source) => {
      if (source.sourceKind !== "external") return source;
      if (source.probation === false || source.creatorClaimed === true) {
        return { ...source, probation: false };
      }
      const paidQueryCount = sourcePaidQueryCount(ledger, source.id);
      const probation = !(
        source.verifiedCreator && paidQueryCount >= matureAfter
      );
      return { ...source, probation };
    })
    .filter((source) => {
      if (!source.probation) return true;
      return sourcePaidQueryCount(ledger, source.id) < maxProbationCitations;
    });
}

async function settleAndAnchorTrackRecord(
  query: Awaited<ReturnType<typeof createAgentQueryRecord>>,
  receiptEvidence: Parameters<typeof appendSettlement>[1],
): Promise<SettlementResult> {
  const settlement = await appendSettlement(query, receiptEvidence);
  const trackRecord = await publishTrackRecordForAnswer(
    settlement.query,
    settlement.receipts,
    { publicUrl: process.env.LEPTONWEB_PUBLIC_URL },
  );
  if (!trackRecord) return settlement;

  const ledger = await attachTrackRecordEvidence(
    settlement.query.id,
    trackRecord,
  );
  return {
    ...settlement,
    query: { ...settlement.query, trackRecord },
    ledger,
  };
}
