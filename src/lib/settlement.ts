import { readSources } from "./catalog";
import { createQueryRecord } from "./engine";
import { sha256Hex } from "./hash";
import { appendSettlement } from "./ledger";
import type { QueryPaymentEvidence, SettlementResult } from "./types";

const MAX_QUESTION_LENGTH = 280;

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
): Promise<SettlementResult> {
  const normalized = validateQuestion(question);
  const createdAt = new Date().toISOString();
  const sources = await readSources();
  const query = createQueryRecord(normalized, createdAt, sources);
  return appendSettlement(query);
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
): Promise<SettlementResult> {
  const normalized = validateQuestion(question);
  const createdAt = new Date().toISOString();
  const sources = await readSources();
  const readerPayment = createQueryPaymentEvidence(payment);
  const query = createQueryRecord(
    normalized,
    createdAt,
    sources,
    readerPayment,
  );
  return appendSettlement(query);
}
