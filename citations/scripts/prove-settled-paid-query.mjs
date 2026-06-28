import { loadWallet } from "./wallet-keystore.mjs";
import { createPaidFetch } from "./x402-paid-fetch.mjs";

const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3010";
const roleId = process.env.LEPTONWEB_PAYER_ROLE ?? "demo-payer";
const question =
  process.argv.slice(2).join(" ") ||
  "How does Tollgate settle reader payments and creator citation receipts on Arc?";

const statusResponse = await fetch(`${baseUrl}/api/settlement/status`);
const status = await statusResponse.json();
if (
  !statusResponse.ok ||
  status.facilitatorConfigured !== true ||
  status.readerSettlement?.selfFacilitator !== true
) {
  console.error(
    JSON.stringify(
      {
        error: "Target server is not settle-enabled.",
        mode: status.mode ?? null,
        nextStep: "Run npm run start:settle-server in another terminal.",
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

const wallet = await loadWallet(roleId);
const paidFetch = createPaidFetch(wallet.account);
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
      payerRole: wallet.id,
      payer: wallet.address,
      question: body.query?.question,
      settlementMode: body.query?.readerPayment?.settlementMode,
      readerPaymentHash: body.query?.readerPayment?.paymentHash,
      readerPaymentTransaction: body.query?.readerPayment?.transaction ?? null,
      receiptHashes: body.query?.receiptHashes,
      totalCitationAtomicUsdc: body.query?.totalAtomicUsdc,
    },
    null,
    2,
  ),
);
