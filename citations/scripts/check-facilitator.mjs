import { createPublicClient, defineChain, formatEther, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const DEFAULT_AGENT_WALLET = "0x5C94b3aBb29c1dFcA24313B9A2D383960Cd69836";
const PAID_QUERY_PRICE_ATOMIC_USDC = 10_000;

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  testnet: true,
});

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

let chainId = null;
let rpcOk = false;
try {
  chainId = await client.getChainId();
  rpcOk = chainId === ARC_CHAIN_ID;
} catch {
  rpcOk = false;
}

const privateKey = process.env.FACILITATOR_PRIVATE_KEY;
let facilitatorAddress = null;
let facilitatorNativeUsdc = null;
if (privateKey) {
  const account = privateKeyToAccount(privateKey);
  facilitatorAddress = account.address;
  try {
    const balance = await client.getBalance({ address: account.address });
    facilitatorNativeUsdc = formatEther(balance);
  } catch {
    facilitatorNativeUsdc = null;
  }
}

console.log(
  JSON.stringify(
    {
      rpcOk,
      chainId,
      expectedChainId: ARC_CHAIN_ID,
      mode: privateKey ? "settle-enabled" : "verify-only",
      facilitatorConfigured: Boolean(privateKey),
      facilitatorAddress,
      facilitatorNativeUsdc,
      tollgateAgentWallet:
        process.env.LEPTONWEB_AGENT_WALLET ?? DEFAULT_AGENT_WALLET,
      paidQueryPriceAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC,
      nextStep: privateKey
        ? "Run npm run prove:paid-query against a funded payer to attempt settlement."
        : "Run npm run start:settle-server to load the local DPAPI facilitator key, or set FACILITATOR_PRIVATE_KEY in the process environment.",
    },
    null,
    2,
  ),
);
