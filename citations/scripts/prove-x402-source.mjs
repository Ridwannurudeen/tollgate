import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPaidFetch } from "./x402-paid-fetch.mjs";

const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3000";
const sourceId = process.argv[2] ?? "circle-gateway-nano";

const account = privateKeyToAccount(generatePrivateKey());
const paidFetch = createPaidFetch(account);

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
      payer: account.address,
      settlementMode: body.settlementMode,
      receiptHash: body.receipt?.receiptHash,
      amountAtomicUsdc: body.receipt?.amountAtomicUsdc,
      creator: body.receipt?.creator,
    },
    null,
    2,
  ),
);
