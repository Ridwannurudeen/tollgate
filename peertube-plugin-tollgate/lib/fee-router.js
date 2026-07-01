"use strict";

const { createPublicClient, createWalletClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { buildChain } = require("./arc");

// Minimal FeeRouterV1 ABI (matches the deployed Arc contract): create a
// single-recipient split for a creator, then route USDC to it.
const feeRouterAbi = [
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
    name: "splitAt",
    stateMutability: "view",
    inputs: [{ name: "splitId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
          { name: "recipients", type: "address[]" },
          { name: "bps", type: "uint16[]" },
          { name: "totalRouted", type: "uint256" },
          { name: "createdAt", type: "uint64" },
        ],
      },
    ],
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

const SPLITS_KEY = "tollgate:fee-router-splits";

// In-process serialization so two concurrent payouts can't both create a split
// for the same creator.
let splitLock = Promise.resolve();
function withSplitLock(task) {
  const run = splitLock.then(task, task);
  splitLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readSplits(storage) {
  const stored = await storage.get(SPLITS_KEY);
  return stored && Array.isArray(stored.splits) ? stored : { splits: [] };
}

async function ensureCreatorSplit(recipient, clients, storage) {
  const { publicClient, walletClient, account, feeRouter, chain } = clients;
  return withSplitLock(async () => {
    const registry = await readSplits(storage);
    const existing = registry.splits.find(
      (split) => split.wallet.toLowerCase() === recipient.toLowerCase(),
    );
    if (existing) return existing;

    const { result: splitId, request } = await publicClient.simulateContract({
      address: feeRouter,
      abi: feeRouterAbi,
      functionName: "createSplit",
      args: [[recipient], [10000]],
      account: account.address,
      chain,
    });
    const createSplitTx = await walletClient.writeContract({
      ...request,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash: createSplitTx });

    const record = {
      wallet: recipient,
      splitId: splitId.toString(),
      createSplitTx,
      createdAt: new Date().toISOString(),
    };
    await storage.set(SPLITS_KEY, { splits: [...registry.splits, record] });
    return record;
  });
}

// Operator-funded payout: the operator wallet routes `amountAtomicUsdc` USDC to
// the creator through FeeRouterV1. Returns settlement evidence, or null when
// FeeRouter payouts are not configured.
async function routeCreatorPayment(opts) {
  const {
    recipient,
    amountAtomicUsdc,
    privateKey,
    chainId,
    rpcUrl,
    usdc,
    feeRouter,
    storage,
  } = opts;

  if (!privateKey) return null;
  if (!Number.isInteger(amountAtomicUsdc) || amountAtomicUsdc <= 0) {
    throw new Error("amountAtomicUsdc must be a positive integer");
  }

  const chain = buildChain({ chainId, rpcUrl });
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });
  const amount = BigInt(amountAtomicUsdc);

  const [balance, allowance] = await Promise.all([
    publicClient.readContract({
      address: usdc,
      abi: usdcAbi,
      functionName: "balanceOf",
      args: [account.address],
    }),
    publicClient.readContract({
      address: usdc,
      abi: usdcAbi,
      functionName: "allowance",
      args: [account.address, feeRouter],
    }),
  ]);

  if (balance < amount) {
    throw new Error("operator wallet has insufficient USDC balance");
  }

  if (allowance < amount) {
    // Bounded standing allowance (~100 payouts): amortizes the approve tx while
    // capping the FeeRouter's pull exposure on the operator key.
    const approveTx = await walletClient.writeContract({
      address: usdc,
      abi: usdcAbi,
      functionName: "approve",
      args: [feeRouter, amount * 100n],
      account,
      chain,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const split = await ensureCreatorSplit(
    recipient,
    { publicClient, walletClient, account, feeRouter, chain },
    storage,
  );

  const payTx = await walletClient.writeContract({
    address: feeRouter,
    abi: feeRouterAbi,
    functionName: "pay",
    args: [BigInt(split.splitId), amount],
    account,
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: payTx });

  return {
    settlementMode: "forum-routed",
    payer: account.address,
    transaction: payTx,
    feeRouterSplitId: split.splitId,
    feeRouterCreateSplitTx: split.createSplitTx,
  };
}

module.exports = { routeCreatorPayment, SPLITS_KEY };
