# Tollgate Receipt Format

Tollgate receipts are append-only, hash-linked records of paid reuse events.

## Receipt

```ts
type PaymentReceipt = {
  id: string;
  queryId: string;
  sourceId: string;
  creator: string;
  wallet: `0x${string}`;
  amountAtomicUsdc: number;
  settlementMode:
    | "local-proof"
    | "x402-verified"
    | "x402-settled"
    | "forum-routed"
    | "escrowed"
    | "refunded";
  queryPaymentHash?: string;
  payer?: string;
  transaction?: string;
  paymentResource?: string;
  feeRouterSplitId?: string;
  feeRouterCreateSplitTx?: string;
  feeRouterPayTx?: string;
  canonicalUrl?: string;
  sourceContentHash?: string;
  sourceExcerptHash?: string;
  contentFetchedAt?: string;
  ownershipProof?: SourceOwnershipProof;
  payoutPolicy?: "standard" | "escrow-unverified" | "escrow-release" | "refund-unused";
  contributors?: { wallet: `0x${string}`; shareBps: number }[];
  releasedReceiptHashes?: string[];
  refundReason?: string;
  previousHash: string;
  receiptHash: string;
  createdAt: string;
};
```

## Hash Rule

`receiptHash` is `sha256(stableStringify(payload))`, where `payload` contains the receipt fields except `id` and `receiptHash`.

`previousHash` is:

- all-zero hash for the first receipt, or
- the prior receipt's `receiptHash`.

Any verifier can replay the chain from the first receipt and confirm:

- every receipt hash matches its payload;
- each `previousHash` points to the prior receipt;
- every receipt references an existing query;
- every query's `receiptHashes` are present in the receipt table.

## Legacy Candidates

The verifier accepts legacy hash candidates for older x402 source-access and reader-payment receipts where optional `undefined` fields were included in the stable payload. New receipts should use the canonical payload above.

## Settlement Modes

- `local-proof`: local hash-chain proof only.
- `x402-verified`: x402 payment authorization verified.
- `x402-settled`: facilitator or Gateway settlement completed.
- `forum-routed`: creator payout routed through FeeRouter.
- `escrowed`: payout withheld until source ownership verification.
- `refunded`: bought source was not cited in the final answer.

## SQLite Backend

The SQLite backend stores full JSON payloads in append-only tables:

- `queries(id, created_at, payload_json)`
- `receipts(receipt_hash, query_id, previous_hash, created_at, payload_json)`
- `reader_payments(payment_hash, query_id, payload_json)`

Receipt rows are never updated. Query rows may be updated only to attach later TrackRecord evidence.

## On-Chain Anchoring

TrackRecord anchoring publishes a record hash with:

- query hash;
- answer hash;
- citation count;
- total atomic USDC;
- receipt hashes;
- evidence URI.

The receipt chain remains the source of truth; TrackRecord gives the chain a public on-chain anchor.
