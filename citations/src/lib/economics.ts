import { DEFAULT_SOURCE_BUDGET_ATOMIC_USDC } from "./engine";
import { PAID_QUERY_PRICE_ATOMIC_USDC } from "./payments";
import type { Ledger, QueryRecord } from "./types";

export type PaymentEconomics = {
  readerPaidAtomicUsdc: number;
  creatorPayoutsAtomicUsdc: number;
  protocolRetainedAtomicUsdc: number;
  budgetUtilizationPercent: number | null;
};

function paymentEconomics(
  readerPaidAtomicUsdc: number,
  creatorPayoutsAtomicUsdc: number,
): PaymentEconomics {
  return {
    readerPaidAtomicUsdc,
    creatorPayoutsAtomicUsdc,
    protocolRetainedAtomicUsdc:
      readerPaidAtomicUsdc - creatorPayoutsAtomicUsdc,
    budgetUtilizationPercent:
      readerPaidAtomicUsdc > 0
        ? (creatorPayoutsAtomicUsdc / readerPaidAtomicUsdc) * 100
        : null,
  };
}

export function configuredPaymentEconomics(): PaymentEconomics {
  return paymentEconomics(
    PAID_QUERY_PRICE_ATOMIC_USDC,
    DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  );
}

export function queryPaymentEconomics(query: QueryRecord): PaymentEconomics {
  const creatorPayoutsAtomicUsdc = query.citations
    .filter(
      (citation) =>
        citation.payoutPolicy !== "escrow-unverified" &&
        citation.payoutPolicy !== "refund-unused",
    )
    .reduce(
      (sum, citation) =>
        sum + (citation.payoutAtomicUsdc ?? citation.amountAtomicUsdc),
      0,
    );
  return paymentEconomics(
    query.readerPayment?.amountAtomicUsdc ?? 0,
    creatorPayoutsAtomicUsdc,
  );
}

export function ledgerPaidQueryEconomics(ledger: Ledger): PaymentEconomics {
  const paidQueryIds = new Set(
    ledger.queries
      .filter((query) => query.readerPayment)
      .map((query) => query.id),
  );
  const readerPaidAtomicUsdc = ledger.queries.reduce(
    (sum, query) => sum + (query.readerPayment?.amountAtomicUsdc ?? 0),
    0,
  );
  const creatorPayoutsAtomicUsdc = ledger.receipts.reduce(
    (sum, receipt) =>
      paidQueryIds.has(receipt.queryId) &&
      receipt.settlementMode !== "escrowed" &&
      receipt.settlementMode !== "refunded"
        ? sum + receipt.amountAtomicUsdc
        : sum,
    0,
  );

  return paymentEconomics(readerPaidAtomicUsdc, creatorPayoutsAtomicUsdc);
}

export function formatBudgetUtilization(economics: PaymentEconomics): string {
  return economics.budgetUtilizationPercent === null
    ? "n/a"
    : `${economics.budgetUtilizationPercent.toFixed(1)}%`;
}
