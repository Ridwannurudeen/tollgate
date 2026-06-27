# x402-Cite

x402-Cite is Tollgate's citation-toll convention for AI agents that buy source access and reuse that source inside an answer.

It does not replace x402. It adds a citation-shaped envelope around x402:

1. The creator publishes a priced source.
2. The agent receives an `X-402-Cite` toll header describing the source, price, wallet, network, and asset.
3. The agent pays through x402 or a compatible settlement route.
4. The answer emits an `X-402-Cite-Receipt` header binding the paid citation to the answer hash, source receipt hash, amount, payer, and settlement transaction.
5. Tollgate can additionally route creator payouts through Forum FeeRouter and anchor the answer in Forum TrackRecordV2.

## Headers

`X-402-Cite`

Base64url-encoded stable JSON:

```json
{
  "version": "x402-cite/0.1",
  "sourceId": "circle-gateway-nano",
  "title": "Gateway Nanopayments Primer",
  "creator": "Circle Developer Notes",
  "wallet": "0x...",
  "sourceUrl": "https://example.com/api/sources/circle-gateway-nano",
  "priceAtomicUsdc": 2400,
  "network": "eip155:5042002",
  "asset": "0x3600000000000000000000000000000000000000"
}
```

`X-402-Cite-Receipt`

Base64url-encoded stable JSON:

```json
{
  "version": "x402-cite/0.1",
  "queryId": "0xa3d80bbd28ae5ea2",
  "sourceId": "circle-gateway-nano",
  "answerHash": "0x...",
  "receiptHash": "0x...",
  "amountAtomicUsdc": 2400,
  "settlementMode": "x402-verified",
  "payer": "0x...",
  "transaction": "0x...",
  "paidAt": "2026-06-23T00:00:00.000Z"
}
```

## Reference Helper

The tiny reference helper lives in `src/lib/x402-cite.ts`.

It exports:

- `buildX402CiteToll(source, sourceUrl)`
- `buildX402CiteReceipt(query, receipt)`
- `encodeX402CiteHeader(value)`
- `decodeX402CiteHeader(header)`
- `x402CiteReceiptHash(receipt)`

The tests in `src/lib/x402-cite.test.ts` prove toll and receipt header round trips.

## Settlement Modes

`settlementMode` is intentionally the same enum used by Tollgate receipts:

- `x402-verified`: payment signature verified, not settled by a facilitator key in this runtime.
- `x402-settled`: x402 facilitator settled the authorization.
- `forum-routed`: creator payout was routed through Forum FeeRouter.
- `local-proof`: receipt-only development proof.

## On-chain Anchors

For the current Tollgate build, an answer can be anchored three ways:

- Payment receipt hash in `data/ledger.json`.
- Forum FeeRouter split/pay transactions for creator payouts.
- Forum TrackRecordV2 record hash for the answer attribution chain.

The first live TrackRecordV2 anchor for this build is:

- bot: `0x434f104d66bd47acc44e9a77f3653075cbd18071da675682189101e96f316223`
- seq: `1`
- tx: `0x6fa8effe18d3dc6c8a30ed9157f1508cd8a7e5fa747333b9ff08486da2c60955`
- record hash: `0xa015bc878ee8df75fcd7821b4edc80619b48e5f1413cace29ce3c21e670a077a`
