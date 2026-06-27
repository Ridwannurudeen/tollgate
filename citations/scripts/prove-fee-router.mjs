import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatUnits,
  http,
} from "viem";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const FEE_ROUTER = "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59";
const DEFAULT_AMOUNT_ATOMIC_USDC = 1000n;

const feeRouterV1Abi = [
  {
    type: "function",
    name: "splitCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "totalClaimableOf",
    stateMutability: "view",
    inputs: [{ name: "recipient", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "createSplit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipients", type: "address[]" },
      { name: "bps", type: "uint16[]" },
    ],
    outputs: [{ name: "splitId", type: "uint256" }],
  },
  {
    type: "function",
    name: "pay",
    stateMutability: "nonpayable",
    inputs: [
      { name: "splitId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
];

const usdcAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  testnet: true,
});

function parseAmount(value) {
  if (!value) return DEFAULT_AMOUNT_ATOMIC_USDC;
  const amount = BigInt(value);
  if (amount <= 0n)
    throw new Error("FEE_ROUTER_AMOUNT_ATOMIC_USDC must be positive.");
  return amount;
}

function parseBps(value, recipientCount) {
  if (!value) {
    return recipientCount === 1
      ? [10_000]
      : Array.from({ length: recipientCount }, () =>
          Math.floor(10_000 / recipientCount),
        ).map((bps, index) =>
          index === 0 ? bps + (10_000 % recipientCount) : bps,
        );
  }
  return value.split(",").map((part) => Number(part.trim()));
}

function assertValidSplit(recipients, bps) {
  if (recipients.length === 0) throw new Error("No FeeRouter recipients.");
  if (recipients.length !== bps.length) {
    throw new Error(
      "FEE_ROUTER_RECIPIENTS and FEE_ROUTER_BPS length mismatch.",
    );
  }
  const total = bps.reduce((sum, value) => sum + value, 0);
  if (total !== 10_000) {
    throw new Error(`FEE_ROUTER_BPS must sum to 10000; got ${total}.`);
  }
}

const funding = JSON.parse(
  await readFile(
    new URL("../wallets/funding-addresses.json", import.meta.url),
    "utf8",
  ),
);
const walletById = new Map(
  funding.wallets.map((wallet) => [wallet.id, wallet]),
);
const defaultRecipient = walletById.get("creator-primary")?.address;
if (!defaultRecipient) throw new Error("creator-primary wallet is missing.");

const payerRole = process.env.FEE_ROUTER_PAYER_ROLE ?? "demo-payer";
const recipients = (process.env.FEE_ROUTER_RECIPIENTS ?? defaultRecipient)
  .split(",")
  .map((address) => address.trim())
  .filter(Boolean);
const bps = parseBps(process.env.FEE_ROUTER_BPS, recipients.length);
const amount = parseAmount(process.env.FEE_ROUTER_AMOUNT_ATOMIC_USDC);
const execute = process.env.FEE_ROUTER_EXECUTE === "1";

assertValidSplit(recipients, bps);

const payer = await loadWallet(payerRole);
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

const [chainId, splitCountBefore, balanceBefore, allowanceBefore] =
  await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({
      address: FEE_ROUTER,
      abi: feeRouterV1Abi,
      functionName: "splitCount",
    }),
    publicClient.readContract({
      address: ARC_USDC,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [payer.address],
    }),
    publicClient.readContract({
      address: ARC_USDC,
      abi: usdcAbi,
      functionName: "allowance",
      args: [payer.address, FEE_ROUTER],
    }),
  ]);

const readiness = {
  ok: chainId === ARC_CHAIN_ID && balanceBefore >= amount,
  chainId,
  expectedChainId: ARC_CHAIN_ID,
  execute,
  payerRole: payer.id,
  payer: payer.address,
  feeRouter: FEE_ROUTER,
  usdc: ARC_USDC,
  recipients,
  bps,
  amountAtomicUsdc: amount.toString(),
  amountUsdc: formatUnits(amount, 6),
  splitCountBefore: splitCountBefore.toString(),
  payerAssetBalanceAtomicUsdc: balanceBefore.toString(),
  payerAssetBalanceUsdc: formatUnits(balanceBefore, 6),
  payerAllowanceAtomicUsdc: allowanceBefore.toString(),
};

if (!execute) {
  console.log(
    JSON.stringify(
      {
        ...readiness,
        nextStep:
          "Set FEE_ROUTER_EXECUTE=1 to approve USDC, create a split, and route the payment.",
      },
      null,
      2,
    ),
  );
  if (!readiness.ok) process.exitCode = 1;
}

if (!readiness.ok) {
  console.error(JSON.stringify(readiness, null, 2));
  process.exitCode = 1;
} else if (execute) {
  const walletClient = createWalletClient({
    account: payer.account,
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });

  let approveTx = null;
  if (allowanceBefore < amount) {
    approveTx = await walletClient.writeContract({
      address: ARC_USDC,
      abi: usdcAbi,
      functionName: "approve",
      args: [FEE_ROUTER, amount],
      account: payer.account,
      chain: arcTestnet,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const splitId = splitCountBefore;
  const createSplitTx = await walletClient.writeContract({
    address: FEE_ROUTER,
    abi: feeRouterV1Abi,
    functionName: "createSplit",
    args: [recipients, bps],
    account: payer.account,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash: createSplitTx });

  const payTx = await walletClient.writeContract({
    address: FEE_ROUTER,
    abi: feeRouterV1Abi,
    functionName: "pay",
    args: [splitId, amount],
    account: payer.account,
    chain: arcTestnet,
  });
  await publicClient.waitForTransactionReceipt({ hash: payTx });

  const claimables = await Promise.all(
    recipients.map((recipient) =>
      publicClient.readContract({
        address: FEE_ROUTER,
        abi: feeRouterV1Abi,
        functionName: "totalClaimableOf",
        args: [recipient],
      }),
    ),
  );

  console.log(
    JSON.stringify(
      {
        ...readiness,
        splitId: splitId.toString(),
        approveTx,
        createSplitTx,
        payTx,
        claimables: recipients.map((recipient, index) => ({
          recipient,
          claimableAtomicUsdc: claimables[index].toString(),
          claimableUsdc: formatUnits(claimables[index], 6),
        })),
      },
      null,
      2,
    ),
  );
}
