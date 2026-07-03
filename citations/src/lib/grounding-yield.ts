import type { Ledger } from "./types";

export type GroundingYield = {
  sourceId: string;
  used: number;
  bought: number;
  value: number;
};

export type GroundingYieldMap = ReadonlyMap<string, GroundingYield>;

export function groundingYield(
  ledger: Ledger,
  sourceId: string,
): GroundingYield {
  let used = 0;
  let bought = 0;
  for (const receipt of ledger.receipts) {
    if (receipt.sourceId !== sourceId) continue;
    bought += 1;
    if (receipt.settlementMode !== "refunded") used += 1;
  }
  return {
    sourceId,
    used,
    bought,
    value: (used + 1) / (bought + 2),
  };
}

export function groundingYieldsBySource(ledger: Ledger): GroundingYieldMap {
  const counts = new Map<string, { used: number; bought: number }>();
  for (const receipt of ledger.receipts) {
    const current = counts.get(receipt.sourceId) ?? { used: 0, bought: 0 };
    current.bought += 1;
    if (receipt.settlementMode !== "refunded") current.used += 1;
    counts.set(receipt.sourceId, current);
  }
  return new Map(
    Array.from(counts.entries()).map(([sourceId, count]) => [
      sourceId,
      {
        sourceId,
        used: count.used,
        bought: count.bought,
        value: (count.used + 1) / (count.bought + 2),
      },
    ]),
  );
}

export function groundingYieldValue(
  yields: GroundingYieldMap | undefined,
  sourceId: string,
): number {
  return yields?.get(sourceId)?.value ?? 0.5;
}
