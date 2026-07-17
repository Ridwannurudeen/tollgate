import { createW3SPaidFetch } from "./x402-paid-fetch-w3s.mjs";
import { payerWalletId, payerAddress } from "./circle-w3s.mjs";

const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3000";
const question =
  process.argv.slice(2).join(" ") ||
  "How does Tollgate prove paid citations with x402 receipts on Arc?";

const walletId = payerWalletId();
const address = payerAddress();
const paidFetch = createW3SPaidFetch({ walletId, address });

const response = await paidFetch(`${baseUrl}/api/paid-query`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question }),
});
const body = await response.json();

if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      payer: address,
      signedBy: "circle-w3s",
      question: body.query?.question,
      settlementMode: body.query?.readerPayment?.settlementMode,
      readerPaymentHash: body.query?.readerPayment?.paymentHash,
      readerPaymentAtomicUsdc: body.query?.readerPayment?.amountAtomicUsdc,
      receiptHashes: body.query?.receiptHashes,
      totalCitationAtomicUsdc: body.query?.totalAtomicUsdc,
    },
    null,
    2,
  ),
);
