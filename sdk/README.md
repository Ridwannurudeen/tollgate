# @tollgate/reader

Unpublished TypeScript reader SDK for Tollgate handoff integrations.

This package is private and not published to npm. It does not perform live on-chain spending by itself. The default path is the deterministic local-proof endpoint, and the paid path only runs when the caller supplies an x402-capable `paidFetch`.

## Install

Use it from this repo while the SDK is still unpublished:

```bash
cd sdk
npm install
npm run build
```

## Free local-proof ask

```ts
import { createReader } from "@tollgate/reader";

const tollgate = createReader({
  baseUrl: "http://127.0.0.1:3000",
});

const result = await tollgate.ask(
  "How does Tollgate prove paid citations with receipts?",
);

console.log(result.answer);
console.log(result.query.id);
console.log(result.proofUrls.answer);
console.log(result.proofUrls.receipts);
```

Without a payment adapter, `ask()` posts to `/api/query` and returns:

```ts
type TollgateAskResult = {
  answer: string;
  query: TollgateQuery;
  receipts: TollgateReceipt[];
  proofUrls: {
    proof: string;
    answer: string;
    answerByHash: string;
    receipts: string[];
  };
};
```

## Paid handoff with caller-supplied paidFetch

```ts
import { createReader } from "@tollgate/reader";
import { createPaidFetch } from "./your-x402-adapter";

const tollgate = createReader({
  baseUrl: "https://tollgate.gudman.xyz",
  paidFetch: createPaidFetch(),
});

const result = await tollgate.ask(
  "How does Tollgate prove reader-paid answers on Arc?",
);

console.log(result.query.readerPayment?.settlementMode);
console.log(result.query.readerPayment?.paymentHash);
```

When `paidFetch` is supplied, `ask()` posts to `/api/paid-query`. The SDK does not create signatures, submit payments, or fake an on-chain receipt. `privateKey` and `signer` are typed for the future paid adapter surface, but this unpublished handoff build intentionally rejects them unless a real `paidFetch` is provided.

## Verification

```bash
npm test
npm run typecheck
npm run build
```
