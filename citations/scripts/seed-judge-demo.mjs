const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3000";

function absolutePath(pathname) {
  return new URL(pathname, baseUrl).toString();
}

const response = await fetch(absolutePath("/api/judge-demo"), {
  method: "POST",
  headers: { "content-type": "application/json" },
});
const body = await response.json().catch(() => ({
  error: "Judge demo returned a non-JSON response.",
}));
const ledger = body?.ledger;
const output = {
  baseUrl,
  httpStatus: response.status,
  ok: response.ok,
  ...body,
  ledger: ledger
    ? {
        queryCount: ledger.queries?.length ?? 0,
        receiptCount: ledger.receipts?.length ?? 0,
        latestReceiptHash: ledger.receipts?.at(-1)?.receiptHash ?? null,
      }
    : undefined,
  answerUrl: body?.query?.id
    ? absolutePath(`/answers/${body.query.id}`)
    : null,
  proofUrl: absolutePath("/proof"),
};

console.log(JSON.stringify(output, null, 2));
if (!response.ok || body?.stage !== "complete") process.exitCode = 1;
