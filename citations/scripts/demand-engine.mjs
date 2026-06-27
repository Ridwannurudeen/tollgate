const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "http://127.0.0.1:3000";
const execute = process.env.DEMAND_ENGINE_EXECUTE === "1";
const maxRuns = Number(process.env.DEMAND_ENGINE_MAX_RUNS ?? "3");
const maxAtomicUsdc = Number(
  process.env.DEMAND_ENGINE_MAX_ATOMIC_USDC ?? "15000",
);
const questions = (
  process.env.DEMAND_ENGINE_QUESTIONS?.split("\n") ?? [
    "How can a budgeted AI agent buy publisher citations without overspending?",
    "Why do x402 and Gateway make sub-cent source payments possible?",
    "How does Tollgate prove paid citations with Forum TrackRecord records?",
  ]
)
  .map((question) => question.trim())
  .filter(Boolean)
  .slice(0, maxRuns);

if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 25) {
  throw new Error("DEMAND_ENGINE_MAX_RUNS must be an integer from 1 to 25.");
}
if (
  !Number.isInteger(maxAtomicUsdc) ||
  maxAtomicUsdc < 1 ||
  maxAtomicUsdc > 1_000_000
) {
  throw new Error(
    "DEMAND_ENGINE_MAX_ATOMIC_USDC must be an integer from 1 to 1000000.",
  );
}

function endpoint(path) {
  return new URL(path, baseUrl).toString();
}

async function postQuery(question, index) {
  const response = await fetch(endpoint("/api/query"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `demand-engine-${Date.now()}-${index}`,
    },
    body: JSON.stringify({ question }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Query ${index + 1} failed with HTTP ${response.status}: ${JSON.stringify(
        body,
      )}`,
    );
  }
  return body;
}

if (!execute) {
  console.log(
    JSON.stringify(
      {
        baseUrl,
        execute,
        maxRuns,
        maxAtomicUsdc,
        plannedQuestions: questions,
        note: "Set DEMAND_ENGINE_EXECUTE=1 to run these queries against /api/query.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const runs = [];
let spentAtomicUsdc = 0;
for (const [index, question] of questions.entries()) {
  if (spentAtomicUsdc >= maxAtomicUsdc) break;
  const result = await postQuery(question, index);
  const query = result.query;
  const amount = Number(query?.totalAtomicUsdc ?? 0);
  spentAtomicUsdc += amount;
  runs.push({
    question,
    queryId: query?.id,
    answerHash: query?.answerHash,
    totalAtomicUsdc: amount,
    citationCount: query?.citations?.length ?? 0,
    receiptHashes: Array.isArray(result.receipts)
      ? result.receipts.map((receipt) => receipt.receiptHash)
      : [],
    answerUrl: query?.id ? endpoint(`/answers/${query.id}`) : null,
  });
}

if (spentAtomicUsdc > maxAtomicUsdc) {
  throw new Error(
    `Demand engine exceeded cap after final query: ${spentAtomicUsdc}/${maxAtomicUsdc} atomic USDC.`,
  );
}

console.log(
  JSON.stringify(
    {
      baseUrl,
      execute,
      maxRuns,
      maxAtomicUsdc,
      spentAtomicUsdc,
      runs,
    },
    null,
    2,
  ),
);
