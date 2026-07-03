import type { CreatorSource, PaymentReceipt } from "./types";

function receiptTime(receipt: PaymentReceipt): number {
  const time = Date.parse(receipt.createdAt);
  return Number.isFinite(time) ? time : 0;
}

export function recentReceiptTickerReceipts(
  receipts: PaymentReceipt[],
  limit = 8,
): PaymentReceipt[] {
  return receipts
    .map((receipt, index) => ({ receipt, index }))
    .sort(
      (left, right) =>
        receiptTime(right.receipt) - receiptTime(left.receipt) ||
        right.index - left.index,
    )
    .slice(0, limit)
    .map(({ receipt }) => receipt);
}

export function verifiedExternalCreatorSources(
  sources: CreatorSource[],
  limit = 3,
): CreatorSource[] {
  return sources
    .filter(
      (source) => source.creatorKind === "external" && source.verifiedCreator,
    )
    .slice(0, limit);
}
