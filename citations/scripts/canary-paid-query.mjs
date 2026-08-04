import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createPaidFetch } from "./x402-paid-fetch.mjs";

const ARC_RPC_URL = "https://rpc.testnet.arc.network";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const QUESTION = "How does Tollgate prove paid citations with x402 receipts on Arc?";

// A paid query is the only probe that reaches the facilitator, the nonce
// allocator, PayGate, and the ledger append. Every one of those failed silently
// for two weeks behind a /core that answered 200 the whole time.
const balanceOfAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

async function readProof(baseUrl) {
  const response = await fetch(`${baseUrl}/api/proof`);
  if (!response.ok) {
    throw new Error(`/api/proof returned HTTP ${response.status}`);
  }
  return response.json();
}

export async function runCanaryPaidQuery({ baseUrl, account, question }) {
  const before = await readProof(baseUrl);
  const statusResponse = await fetch(`${baseUrl}/api/settlement/status`);
  if (!statusResponse.ok) {
    throw new Error(
      `/api/settlement/status returned HTTP ${statusResponse.status}`,
    );
  }
  const quoted = (await statusResponse.json()).paidQueryPriceAtomicUsdc;
  if (!Number.isInteger(quoted) || quoted <= 0) {
    throw new Error(`unusable paid-query quote: ${quoted}`);
  }

  // Separates "the rail is broken" from "the canary ran out of money", which
  // otherwise surface as the same failed payment.
  const publicClient = createPublicClient({ transport: http(ARC_RPC_URL) });
  const balance = await publicClient.readContract({
    address: ARC_USDC,
    abi: balanceOfAbi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance < BigInt(quoted)) {
    throw new Error(
      `canary payer ${account.address} holds ${balance} atomic USDC, below the ${quoted} quote — fund it, the rail is untested until you do`,
    );
  }

  const paidFetch = createPaidFetch(account);
  const response = await paidFetch(`${baseUrl}/api/paid-query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: question ?? QUESTION }),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `paid query failed: HTTP ${response.status} stage=${body.stage ?? "unknown"} ${body.error ?? ""}`.trim(),
    );
  }

  const after = await readProof(baseUrl);
  const verification = after.ledger?.verification;
  if (!verification?.ok) {
    throw new Error(
      `ledger verification failed after a successful payment: ${JSON.stringify(verification?.issues ?? null)}`,
    );
  }
  // The failure that cost readers money did not look like an outage: the payment
  // settled and the query was simply never recorded.
  const beforeCount = before.ledger?.verification?.queryCount ?? 0;
  if (verification.queryCount <= beforeCount) {
    throw new Error(
      `reader was charged but the ledger did not grow (${beforeCount} -> ${verification.queryCount})`,
    );
  }

  return {
    payer: account.address,
    settlementMode: body.query?.readerPayment?.settlementMode,
    readerPaymentAtomicUsdc: body.query?.readerPayment?.amountAtomicUsdc,
    refundAtomicUsdc: body.query?.readerPayment?.refund?.amountAtomicUsdc ?? 0,
    creatorPayoutAtomicUsdc: body.query?.totalAtomicUsdc,
    receipts: body.query?.receiptHashes?.length ?? 0,
    queryCount: verification.queryCount,
    receiptCount: verification.receiptCount,
  };
}

const invokedDirectly = process.argv[1]?.endsWith("canary-paid-query.mjs");
if (invokedDirectly) {
  const baseUrl = process.env.LEPTONWEB_BASE_URL ?? "https://tollgate.gudman.xyz";
  const privateKey = process.env.TOLLGATE_CANARY_PAYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error(
      "TOLLGATE_CANARY_PAYER_PRIVATE_KEY is not set. The canary needs its own funded payer key; it deliberately does not reuse the FeeRouter or agent keys.",
    );
    process.exit(1);
  }
  try {
    const result = await runCanaryPaidQuery({
      baseUrl,
      account: privateKeyToAccount(privateKey),
      question: process.argv.slice(2).join(" ") || undefined,
    });
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
