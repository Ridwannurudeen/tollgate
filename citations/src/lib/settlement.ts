import { readSources } from "./catalog";
import { createAgentQueryRecord } from "./agent";
import { refundReaderPayment, routeCitationPayments } from "./fee-router";
import { groundingYieldsBySource } from "./grounding-yield";
import { sha256Hex } from "./hash";
import {
  appendSettlement,
  attachTrackRecordEvidence,
  readLedger,
} from "./ledger";
import { publishTrackRecordForAnswer } from "./track-record";
import type {
  CreatorSource,
  Ledger,
  QueryPaymentEvidence,
  SettlementResult,
} from "./types";

const MAX_QUESTION_LENGTH = 280;
const DEFAULT_PROBATION_DISTINCT_QUERY_THRESHOLD = 3;
const DEFAULT_PROBATION_MAX_PAID_CITATIONS = 3;

type SettleOptions = {
  creatorWallet?: string;
};

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
  const query = await createAgentQueryRecord(
    normalized,
    createdAt,
    agentSources,
    undefined,
    { groundingYields: groundingYieldsBySource(ledger) },
  );
  const receiptEvidence = await routeCitationPayments(query);
  return settleAndAnchorTrackRecord(query, receiptEvidence);
}

export function createQueryPaymentEvidence(
  payment: Omit<QueryPaymentEvidence, "paymentHash">,
): QueryPaymentEvidence {
  const payload: Omit<QueryPaymentEvidence, "paymentHash"> = {
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
  const query = await createAgentQueryRecord(
    normalized,
    createdAt,
    agentSources,
    readerPayment,
    { groundingYields: groundingYieldsBySource(ledger) },
  );
  if (
    query.citations.length === 0 &&
    query.readerPayment?.payer &&
    /^0x[0-9a-fA-F]{40}$/.test(query.readerPayment.payer) &&
    query.readerPayment.amountAtomicUsdc > 0
  ) {
    const refundTx = await refundReaderPayment(
      query.readerPayment.payer as `0x${string}`,
      query.readerPayment.amountAtomicUsdc,
    ).catch(() => null);
    if (refundTx) {
      query.readerPayment.refund = {
        amountAtomicUsdc: query.readerPayment.amountAtomicUsdc,
        transaction: refundTx,
        reason: "no-answer",
      };
    }
  }
  const receiptEvidence = await routeCitationPayments(query);
  return settleAndAnchorTrackRecord(query, receiptEvidence);
}

export function filterSourcesForSettlement(
  sources: CreatorSource[],
  options: SettleOptions,
): CreatorSource[] {
  if (!options.creatorWallet) return sources;
  const creatorWallet = options.creatorWallet.toLowerCase();
  const filtered = sources.filter(
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
