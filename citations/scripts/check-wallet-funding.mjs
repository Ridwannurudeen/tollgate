import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  defineChain,
  formatEther,
  formatUnits,
  http,
} from "viem";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const PAID_QUERY_PRICE_ATOMIC_USDC = 1000n;
const PRIMARY_SOURCE_ID = "leptonweb-build-log";

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  testnet: true,
});

const funding = JSON.parse(
  await readFile(
    new URL("../wallets/funding-addresses.json", import.meta.url),
    "utf8",
  ),
);
const sources = JSON.parse(
  await readFile(new URL("../data/sources.json", import.meta.url), "utf8"),
);

const client = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

const primarySourcePrice = BigInt(
  sources.find((source) => source.id === PRIMARY_SOURCE_ID)?.priceAtomicUsdc ??
    0,
);

async function readBalances(wallet) {
  const nativeBalance = await client.getBalance({ address: wallet.address });
  const assetBalance = await client.readContract({
    address: ARC_USDC,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: [wallet.address],
  });

  return {
    id: wallet.id,
    label: wallet.label,
    purpose: wallet.purpose,
    address: wallet.address,
    nativeAtomicUsdc: nativeBalance.toString(),
    nativeUsdc: formatEther(nativeBalance),
    assetAtomicUsdc: assetBalance.toString(),
    assetUsdc: formatUnits(assetBalance, 6),
  };
}

const chainId = await client.getChainId();
const wallets = await Promise.all(funding.wallets.map(readBalances));
const walletById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
const demoPayer = walletById.get("demo-payer");
const facilitator = walletById.get("x402-facilitator");

const issues = [];
if (chainId !== ARC_CHAIN_ID) {
  issues.push(`Arc RPC returned chain ${chainId}, expected ${ARC_CHAIN_ID}.`);
}
if (!demoPayer) {
  issues.push("Missing demo-payer wallet.");
}
if (!facilitator) {
  issues.push("Missing x402-facilitator wallet.");
}
if (
  demoPayer &&
  BigInt(demoPayer.assetAtomicUsdc) < PAID_QUERY_PRICE_ATOMIC_USDC
) {
  issues.push(
    `demo-payer needs at least ${PAID_QUERY_PRICE_ATOMIC_USDC} atomic USDC asset balance for npm run prove:settled-paid-query.`,
  );
}
if (facilitator && BigInt(facilitator.nativeAtomicUsdc) === 0n) {
  issues.push("x402-facilitator needs nonzero native USDC for settlement gas.");
}

const ready = {
  settledPaidQuery:
    chainId === ARC_CHAIN_ID &&
    Boolean(demoPayer) &&
    Boolean(facilitator) &&
    BigInt(demoPayer?.assetAtomicUsdc ?? "0") >= PAID_QUERY_PRICE_ATOMIC_USDC &&
    BigInt(facilitator?.nativeAtomicUsdc ?? "0") > 0n,
  settledSourcePurchase:
    chainId === ARC_CHAIN_ID &&
    Boolean(demoPayer) &&
    Boolean(facilitator) &&
    primarySourcePrice > 0n &&
    BigInt(demoPayer?.assetAtomicUsdc ?? "0") >= primarySourcePrice &&
    BigInt(facilitator?.nativeAtomicUsdc ?? "0") > 0n,
};
ready.allOneShotProofs = ready.settledPaidQuery && ready.settledSourcePurchase;

const result = {
  ok: ready.settledPaidQuery,
  chainId,
  expectedChainId: ARC_CHAIN_ID,
  rpcUrl: ARC_RPC_URL,
  asset: ARC_USDC,
  requirements: {
    paidQueryPriceAtomicUsdc: PAID_QUERY_PRICE_ATOMIC_USDC.toString(),
    primarySourceId: PRIMARY_SOURCE_ID,
    primarySourcePriceAtomicUsdc: primarySourcePrice.toString(),
    recommendedDemoPayerAtomicUsdc: (
      PAID_QUERY_PRICE_ATOMIC_USDC + primarySourcePrice
    ).toString(),
    facilitatorNativeUsdc: "nonzero",
  },
  ready,
  wallets,
  issues,
};

console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
