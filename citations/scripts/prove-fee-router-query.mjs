import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadWallet } from "./wallet-keystore.mjs";

const port = process.env.LEPTONWEB_FEE_ROUTER_PORT ?? "3020";
const portNumber = Number(port);
if (!/^\d{2,5}$/.test(port) || portNumber < 1 || portNumber > 65535) {
  throw new Error("LEPTONWEB_FEE_ROUTER_PORT must be a numeric TCP port.");
}

const baseUrl = `http://127.0.0.1:${port}`;
const roleId = process.env.LEPTONWEB_FEE_ROUTER_PAYER_ROLE ?? "demo-payer";
const question =
  process.argv.slice(2).join(" ") ||
  "How does LeptonWeb use Forum FeeRouter to route paid creator citation receipts on Arc?";

function absolutePath(path) {
  return new URL(path, baseUrl).toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJson(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${label} failed with HTTP ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function waitForStatus(child, getOutput) {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next server exited early.\n${getOutput()}`);
    }
    try {
      const response = await fetch(absolutePath("/api/settlement/status"), {
        cache: "no-store",
      });
      if (response.ok) return response.json();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(1_000);
  }
  throw new Error(
    `Timed out waiting for Next server.${
      lastError ? ` Last error: ${lastError}` : ""
    }\n${getOutput()}`,
  );
}

const payer = await loadWallet(roleId);
const child = spawn(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/next/dist/bin/next", import.meta.url),
    ),
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    port,
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      LEPTONWEB_BASE_URL: baseUrl,
      LEPTONWEB_FEE_ROUTER_ENABLED: "1",
      LEPTONWEB_FEE_ROUTER_PRIVATE_KEY: payer.privateKey,
    },
  },
);

let serverOutput = "";
function appendOutput(chunk) {
  serverOutput = `${serverOutput}${chunk.toString()}`.slice(-8_000);
}
child.stdout.on("data", appendOutput);
child.stderr.on("data", appendOutput);

try {
  const status = await waitForStatus(child, () => serverOutput);
  if (!status.forumRouterConfigured) {
    throw new Error("FeeRouter route is not enabled on the proof server.");
  }

  const response = await fetch(absolutePath("/api/query"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const result = await readJson(response, "FeeRouter query proof");
  const receipts = Array.isArray(result.receipts) ? result.receipts : [];
  if (receipts.length === 0) {
    throw new Error("FeeRouter query proof returned no receipts.");
  }

  const unrouted = receipts.filter(
    (receipt) =>
      receipt.settlementMode !== "forum-routed" ||
      !receipt.feeRouterSplitId ||
      !receipt.feeRouterCreateSplitTx ||
      !receipt.feeRouterPayTx,
  );
  if (unrouted.length > 0) {
    throw new Error(
      "FeeRouter query proof returned incomplete route evidence.",
    );
  }

  const nextStatusResponse = await fetch(
    absolutePath("/api/settlement/status"),
  );
  const nextStatus = await readJson(
    nextStatusResponse,
    "settlement status after FeeRouter proof",
  );

  console.log(
    JSON.stringify(
      {
        baseUrl,
        payerRole: payer.id,
        payer: payer.address,
        question: result.query?.question,
        queryId: result.query?.id,
        answerUrl: result.query?.id
          ? absolutePath(`/answers/${result.query.id}`)
          : null,
        proofUrl: absolutePath("/proof"),
        totalCitationAtomicUsdc: result.query?.totalAtomicUsdc,
        receiptHashes: receipts.map((receipt) => receipt.receiptHash),
        receiptUrls: receipts.map((receipt) =>
          absolutePath(`/receipts/${receipt.receiptHash}`),
        ),
        feeRouterSplits: receipts.map((receipt) => ({
          sourceId: receipt.sourceId,
          splitId: receipt.feeRouterSplitId,
          createSplitTx: receipt.feeRouterCreateSplitTx,
          payTx: receipt.feeRouterPayTx,
        })),
        latestForumRoutedReceipt: nextStatus.latestForumRoutedReceipt ?? null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        error:
          error instanceof Error ? error.message : "FeeRouter proof failed.",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
