import { loadWallet } from "./wallet-keystore.mjs";
import { createPaidFetch } from "./x402-paid-fetch.mjs";

const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3000";
const roleId = process.env.LEPTONWEB_PAYER_ROLE ?? "demo-payer";
const sourceId = process.argv[2] ?? "leptonweb-build-log";

const wallet = await loadWallet(roleId);
const paidFetch = createPaidFetch(wallet.account);

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
      payerRole: wallet.id,
      payer: wallet.address,
      settlementMode: body.settlementMode,
      receiptHash: body.receipt?.receiptHash,
      amountAtomicUsdc: body.receipt?.amountAtomicUsdc,
      creator: body.receipt?.creator,
    },
    null,
    2,
  ),
);
