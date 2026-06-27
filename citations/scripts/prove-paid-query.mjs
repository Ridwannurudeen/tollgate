import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPaidFetch } from "./x402-paid-fetch.mjs";

const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3000";
const question =
  process.argv.slice(2).join(" ") ||
  "How does Tollgate prove paid citations with x402 receipts on Arc?";

const account = privateKeyToAccount(generatePrivateKey());
const paidFetch = createPaidFetch(account);

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
      payer: account.address,
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
