import { createW3SPaidFetch } from "./x402-paid-fetch-w3s.mjs";
import { payerWalletId, payerAddress } from "./circle-w3s.mjs";

const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3000";
const sourceId = process.argv[2] ?? "circle-gateway-nano";

const walletId = payerWalletId();
const address = payerAddress();
const paidFetch = createW3SPaidFetch({ walletId, address });

const response = await paidFetch(`${baseUrl}/api/sources/${sourceId}`);
const body = await response.json();

if (!response.ok) {
  console.error(JSON.stringify(body, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      sourceId,
      payer: address,
      signedBy: "circle-w3s",
      settlementMode: body.settlementMode,
      receiptHash: body.receipt?.receiptHash,
      amountAtomicUsdc: body.receipt?.amountAtomicUsdc,
      creator: body.receipt?.creator,
    },
    null,
    2,
  ),
);
