import { sha256Hex, stableStringify } from "./hash";
import type {
  CreatorSource,
  PaymentReceipt,
  QueryRecord,
  SettlementMode,
} from "./types";

export const X402_CITE_VERSION = "x402-cite/0.1";
export const X402_CITE_HEADER = "X-402-Cite";
export const X402_CITE_RECEIPT_HEADER = "X-402-Cite-Receipt";

export type X402CiteToll = {
  version: typeof X402_CITE_VERSION;
  sourceId: string;
  title: string;
  creator: string;
  wallet: `0x${string}`;
  sourceUrl: string;
  priceAtomicUsdc: number;
  network: "eip155:5042002";
  asset: `0x${string}`;
};

export type X402CiteReceipt = {
  version: typeof X402_CITE_VERSION;
  queryId: string;
  sourceId: string;
  answerHash: string;
  receiptHash: string;
  amountAtomicUsdc: number;
  settlementMode: SettlementMode;
  payer?: string;
  transaction?: string;
  feeRouterPayTx?: string;
  paidAt: string;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function encodeX402CiteHeader(
  value: X402CiteToll | X402CiteReceipt,
): string {
  return encodeBase64Url(stableStringify(value));
}

export function decodeX402CiteHeader<T extends X402CiteToll | X402CiteReceipt>(
  header: string,
): T | null {
  try {
    const parsed = JSON.parse(decodeBase64Url(header)) as T;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== X402_CITE_VERSION ||
      typeof parsed.sourceId !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function buildX402CiteToll(
  source: CreatorSource,
  sourceUrl: string,
): X402CiteToll {
  return {
    version: X402_CITE_VERSION,
    sourceId: source.id,
    title: source.title,
    creator: source.creator,
    wallet: source.wallet,
    sourceUrl,
    priceAtomicUsdc: source.priceAtomicUsdc,
    network: "eip155:5042002",
    asset: "0x3600000000000000000000000000000000000000",
  };
}

export function buildX402CiteReceipt(
  query: QueryRecord,
  receipt: PaymentReceipt,
): X402CiteReceipt {
  const payload: X402CiteReceipt = {
    version: X402_CITE_VERSION,
    queryId: query.id,
    sourceId: receipt.sourceId,
    answerHash: query.answerHash,
    receiptHash: receipt.receiptHash,
    amountAtomicUsdc: receipt.amountAtomicUsdc,
    settlementMode: receipt.settlementMode,
    paidAt: receipt.createdAt,
  };
  if (receipt.payer !== undefined) payload.payer = receipt.payer;
  if (receipt.transaction !== undefined)
    payload.transaction = receipt.transaction;
  if (receipt.feeRouterPayTx !== undefined) {
    payload.feeRouterPayTx = receipt.feeRouterPayTx;
  }
  return payload;
}

export function x402CiteReceiptHash(receipt: X402CiteReceipt): string {
  return sha256Hex(receipt);
}
