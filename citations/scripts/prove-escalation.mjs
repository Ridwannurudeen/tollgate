import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
} from "viem";
import { loadWallet } from "./wallet-keystore.mjs";

const rpcUrl =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const roleId = process.env.LEPTONWEB_ESCALATION_PAYER_ROLE ?? "demo-payer";
const question =
  process.argv.slice(2).join(" ") ||
  "What should an AI citation buyer verify before trusting a paid source?";
const provider = {
  id: "citepay",
  endpoint: "https://citepay-markets.vercel.app/api/ask",
  recipient: "0x5389688243328c26a92b301faEEAb5fbf9AFf105",
  priceAtomicUsdc: 1_000n,
};
const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});
const usdc = "0x3600000000000000000000000000000000000000";
const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryRead(label, read) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      lastError = error;
      await sleep(750 * (attempt + 1));
    }
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} failed after retries: ${message}`);
}

async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new Error(`${method} ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload.result;
}

const payer = await loadWallet(roleId);
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(rpcUrl),
});
const walletClient = createWalletClient({
  account: payer.account,
  chain: arcTestnet,
  transport: http(rpcUrl),
});
const chainId = Number(
  await retryRead("Arc RPC chain id", () => rpc("eth_chainId")),
);
if (chainId !== arcTestnet.id) {
  throw new Error(
    `Arc RPC returned chain ${chainId}, expected ${arcTestnet.id}.`,
  );
}
const balance = await retryRead("Escalation payer balance", () =>
  publicClient.readContract({
    address: usdc,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [payer.account.address],
  }),
);
if (balance < provider.priceAtomicUsdc) {
  throw new Error("Escalation payer has insufficient USDC asset balance.");
}
const txHash = await walletClient.writeContract({
  address: usdc,
  abi: usdcAbi,
  functionName: "transfer",
  args: [provider.recipient, provider.priceAtomicUsdc],
});
const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== "success") {
  throw new Error(`Escalation transfer failed: ${receipt.status}`);
}

const response = await fetch(provider.endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "X-Arc-Tx-Hash": txHash,
  },
  body: JSON.stringify({ query: question }),
});
const payload = await response.json().catch(() => null);
if (!response.ok) {
  throw new Error(
    `CitePay returned HTTP ${response.status}: ${JSON.stringify(payload)}`,
  );
}
if (!payload || typeof payload.answer !== "string") {
  throw new Error("CitePay returned no answer.");
}

console.log(
  JSON.stringify(
    {
      provider: provider.id,
      question,
      amountAtomicUsdc: Number(provider.priceAtomicUsdc),
      txHash,
      queryId: payload.queryId ?? null,
      queryHash: payload.queryHash ?? null,
      answer: payload.answer,
      decisionCount: Array.isArray(payload.decisions)
        ? payload.decisions.length
        : null,
    },
    null,
    2,
  ),
);
