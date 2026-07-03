import { readSources } from "./catalog";
import type { PaymentReceipt, QueryRecord } from "./types";

export async function notifyCreatorReceipts(
  query: QueryRecord,
  receipts: PaymentReceipt[],
): Promise<void> {
  const webhook = process.env.TOLLGATE_NOTIFY_WEBHOOK;
  if (!webhook) return;
  const sources = await readSources();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const notifications = receipts
    .map((receipt) => {
      const source = sourceById.get(receipt.sourceId);
      if (!source?.notifyEmail) return null;
      return {
        notifyEmail: source.notifyEmail,
        sourceId: source.id,
        title: source.title,
        creator: source.creator,
        amountAtomicUsdc: receipt.amountAtomicUsdc,
        settlementMode: receipt.settlementMode,
        receiptHash: receipt.receiptHash,
        queryId: query.id,
        createdAt: receipt.createdAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (notifications.length === 0) return;

  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notifications }),
  });
  if (!response.ok) {
    throw new Error(`notification webhook failed: HTTP ${response.status}`);
  }
}
