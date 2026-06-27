import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPaidFetch } from "./x402-paid-fetch.mjs";

const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3000";
const sourceId = process.env.LEPTONWEB_DEMO_SOURCE_ID ?? "circle-gateway-nano";
const localQuestion =
  process.env.LEPTONWEB_DEMO_LOCAL_QUESTION ??
  "How can a budgeted AI agent buy publisher citations without overspending?";
const paidQuestion =
  process.env.LEPTONWEB_DEMO_PAID_QUESTION ??
  "How does Tollgate prove reader-paid answers and creator citation payouts on Arc?";

function absolutePath(path) {
  return new URL(path, baseUrl).toString();
}

async function readJson(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(
      JSON.stringify(
        {
          error: `${label} failed`,
          status: response.status,
          body,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  return body;
}

function answerSummary(label, result) {
  const query = result.query;
  return {
    label,
    question: query.question,
    queryId: query.id,
    answerUrl: absolutePath(`/answers/${query.id}`),
    answerHashUrl: absolutePath(`/answers/${query.answerHash}`),
    receiptUrls: query.receiptHashes.map((hash) =>
      absolutePath(`/receipts/${hash}`),
    ),
    totalCitationAtomicUsdc: query.totalAtomicUsdc,
    readerPaymentHash: query.readerPayment?.paymentHash ?? null,
    settlementMode: query.readerPayment?.settlementMode ?? "local-proof",
    sourceBudgetAtomicUsdc: query.agentBudget?.sourceBudgetAtomicUsdc ?? null,
    sourceSpentAtomicUsdc: query.agentBudget?.spentAtomicUsdc ?? null,
  };
}

const account = privateKeyToAccount(generatePrivateKey());
const paidFetch = createPaidFetch(account);

const localResponse = await fetch(absolutePath("/api/query"), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: localQuestion }),
});
const localResult = await readJson(localResponse, "local proof answer");

const paidResponse = await paidFetch(absolutePath("/api/paid-query"), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ question: paidQuestion }),
});
const paidResult = await readJson(paidResponse, "x402 reader-paid answer");

const sourceResponse = await paidFetch(
  absolutePath(`/api/sources/${sourceId}`),
);
const sourceResult = await readJson(sourceResponse, "x402 source purchase");

console.log(
  JSON.stringify(
    {
      baseUrl,
      proofUrl: absolutePath("/proof"),
      payer: account.address,
      answers: [
        answerSummary("local-proof answer", localResult),
        answerSummary("x402-verified paid answer", paidResult),
      ],
      sourcePurchase: {
        sourceId,
        sourceUrl: absolutePath(`/sources/${sourceId}`),
        receiptUrl: sourceResult.receipt?.receiptHash
          ? absolutePath(`/receipts/${sourceResult.receipt.receiptHash}`)
          : null,
        receiptHash: sourceResult.receipt?.receiptHash ?? null,
        settlementMode: sourceResult.settlementMode,
        amountAtomicUsdc: sourceResult.receipt?.amountAtomicUsdc ?? null,
        creator: sourceResult.receipt?.creator ?? null,
      },
    },
    null,
    2,
  ),
);
