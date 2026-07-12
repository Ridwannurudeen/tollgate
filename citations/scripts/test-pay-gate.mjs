import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  hashTypedData,
  http,
  isAddress,
  keccak256,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const FEE_ROUTER_ADDRESS = "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const execute = process.env.PAY_GATE_TEST_EXECUTE === "1";

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: {
    default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
});

const useIntentTypes = {
  TollgateUseIntent: [
    { name: "queryHash", type: "bytes32" },
    { name: "candidateSetRoot", type: "bytes32" },
    { name: "selectedSourcesRoot", type: "bytes32" },
    { name: "decisionTraceHash", type: "bytes32" },
    { name: "claimSupportRoot", type: "bytes32" },
    { name: "maxSpendAtomicUsdc", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

const intentComponents = useIntentTypes.TollgateUseIntent;
const payGateAbi = [
  {
    type: "function",
    name: "registry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "feeRouter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "payer",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "payWithIntent",
    stateMutability: "nonpayable",
    inputs: [
      { name: "intent", type: "tuple", components: intentComponents },
      { name: "signature", type: "bytes" },
      {
        name: "payments",
        type: "tuple[]",
        components: [
          { name: "splitId", type: "uint256" },
          { name: "amount", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
];

const registryAbi = [
  {
    type: "function",
    name: "usedNonces",
    stateMutability: "view",
    inputs: [{ name: "nonce", type: "uint256" }],
    outputs: [{ name: "used", type: "bool" }],
  },
  {
    type: "function",
    name: "tollgateAgentWallet",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
];

const feeRouterAbi = [
  {
    type: "function",
    name: "splitCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
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
    name: "claimableOf",
    stateMutability: "view",
    inputs: [
      { name: "splitId", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
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

const USE_INTENT_ANCHORED_TOPIC = keccak256(
  toHex("UseIntentAnchored(bytes32,bytes32,address)"),
).toLowerCase();
const ROUTED_TOPIC = keccak256(
  toHex("Routed(uint256,address,uint256)"),
).toLowerCase();
const PAID_WITH_INTENT_TOPIC = keccak256(
  toHex("PaidWithIntent(bytes32,bytes32,address,uint256)"),
).toLowerCase();

function requiredAddress(name) {
  const configured = process.env[name];
  if (!configured || !isAddress(configured)) {
    throw new Error(`${name} must be a 20-byte EVM address.`);
  }
  return getAddress(configured);
}

function configuredPositiveBigInt(name, fallback) {
  const configured = process.env[name];
  try {
    const value = configured ? BigInt(configured) : fallback;
    if (value <= 0n) throw new Error("not positive");
    return value;
  } catch {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function configuredSplitId() {
  const configured = process.env.PAY_GATE_TEST_SPLIT_ID;
  try {
    const splitId = BigInt(configured ?? "");
    if (splitId < 0n) throw new Error("negative");
    return splitId;
  } catch {
    throw new Error("PAY_GATE_TEST_SPLIT_ID must be a non-negative integer.");
  }
}

function domain(registry) {
  return {
    name: "Tollgate UseReceipt Registry",
    version: "1",
    chainId: ARC_CHAIN_ID,
    verifyingContract: registry,
  };
}

function intent(expiry, nonce, maxSpendAtomicUsdc) {
  const hash = (label) => keccak256(toHex(`pay-gate-test:${label}:${nonce}`));
  return {
    queryHash: hash("query"),
    candidateSetRoot: hash("candidates"),
    selectedSourcesRoot: hash("selected"),
    decisionTraceHash: hash("trace"),
    claimSupportRoot: hash("claims"),
    maxSpendAtomicUsdc,
    expiry,
    nonce,
  };
}

function errorText(error) {
  const messages = [];
  let current = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    for (const field of ["shortMessage", "details", "message"]) {
      if (typeof current[field] === "string") messages.push(current[field]);
    }
    current = current.cause;
  }
  return messages.join("\n");
}

async function expectSimulationRevert(publicClient, request, expected, label) {
  try {
    await publicClient.simulateContract(request);
  } catch (error) {
    const message = errorText(error);
    if (message.includes(expected)) return;
    throw new Error(`${label} reverted for an unexpected reason: ${message}`);
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

async function waitForSuccessfulTransaction(publicClient, transaction, label) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transaction,
  });
  if (receipt.transactionHash.toLowerCase() !== transaction.toLowerCase()) {
    throw new Error(`${label} was replaced.`);
  }
  if (receipt.status !== "success") {
    throw new Error(`${label} failed with status ${receipt.status}.`);
  }
  return receipt;
}

async function nextUnusedNonce(publicClient, registry, start) {
  let nonce = start;
  while (
    await publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "usedNonces",
      args: [nonce],
    })
  ) {
    nonce += 1n;
  }
  return nonce;
}

function paddedAddress(address) {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function paddedUint(value) {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function hasExpectedLogs(receipt, args) {
  const anchor = receipt.logs.some(
    (log) =>
      log.address.toLowerCase() === args.registry.toLowerCase() &&
      log.topics[0]?.toLowerCase() === USE_INTENT_ANCHORED_TOPIC &&
      log.topics[1]?.toLowerCase() === args.queryHash.toLowerCase() &&
      log.topics[2]?.toLowerCase() === args.digest.toLowerCase() &&
      log.topics[3]?.toLowerCase() === paddedAddress(args.agent),
  );
  const routed = receipt.logs.some(
    (log) =>
      log.address.toLowerCase() === FEE_ROUTER_ADDRESS.toLowerCase() &&
      log.topics[0]?.toLowerCase() === ROUTED_TOPIC &&
      log.topics[1]?.toLowerCase() === paddedUint(args.splitId) &&
      log.topics[2]?.toLowerCase() === paddedAddress(args.payGate) &&
      log.data.toLowerCase() === paddedUint(args.amount),
  );
  const paid = receipt.logs.some(
    (log) =>
      log.address.toLowerCase() === args.payGate.toLowerCase() &&
      log.topics[0]?.toLowerCase() === PAID_WITH_INTENT_TOPIC &&
      log.topics[1]?.toLowerCase() === args.queryHash.toLowerCase() &&
      log.topics[2]?.toLowerCase() === args.digest.toLowerCase() &&
      log.topics[3]?.toLowerCase() === paddedAddress(args.payer) &&
      log.data.toLowerCase() === paddedUint(args.amount),
  );
  return { anchor, routed, paid };
}

const payGate = requiredAddress("LEPTONWEB_PAYGATE_ADDRESS");
const expectedRegistry = requiredAddress(
  "LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS",
);
const splitId = configuredSplitId();
const amount = configuredPositiveBigInt("PAY_GATE_TEST_AMOUNT_ATOMIC_USDC", 1n);
const signerRole =
  process.env.LEPTONWEB_PAYGATE_SIGNER_ROLE ?? "tollgate-agent-payee";
const payerRole =
  process.env.LEPTONWEB_PAYGATE_TEST_PAYER_ROLE ?? "tollgate-agent-payee";
const [signer, payer] = await Promise.all([
  loadWallet(signerRole),
  loadWallet(payerRole),
]);
const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});
const walletClient = createWalletClient({
  account: payer.account,
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});
const [
  chainId,
  payGateCode,
  registry,
  feeRouter,
  usdc,
  authorizedPayer,
  authorizedAgent,
  splitCount,
] = await Promise.all([
  publicClient.getChainId(),
  publicClient.getCode({ address: payGate }),
  publicClient.readContract({
    address: payGate,
    abi: payGateAbi,
    functionName: "registry",
  }),
  publicClient.readContract({
    address: payGate,
    abi: payGateAbi,
    functionName: "feeRouter",
  }),
  publicClient.readContract({
    address: payGate,
    abi: payGateAbi,
    functionName: "usdc",
  }),
  publicClient.readContract({
    address: payGate,
    abi: payGateAbi,
    functionName: "payer",
  }),
  publicClient.readContract({
    address: expectedRegistry,
    abi: registryAbi,
    functionName: "tollgateAgentWallet",
  }),
  publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterAbi,
    functionName: "splitCount",
  }),
]);
if (chainId !== ARC_CHAIN_ID) {
  throw new Error(`Connected chain ${chainId} is not Arc testnet.`);
}
if (!payGateCode || payGateCode === "0x") {
  throw new Error("LEPTONWEB_PAYGATE_ADDRESS has no deployed bytecode.");
}
if (registry.toLowerCase() !== expectedRegistry.toLowerCase()) {
  throw new Error("PayGate registry does not match the configured registry.");
}
if (feeRouter.toLowerCase() !== FEE_ROUTER_ADDRESS.toLowerCase()) {
  throw new Error("PayGate FeeRouter does not match FeeRouterV1.");
}
if (usdc.toLowerCase() !== ARC_USDC.toLowerCase()) {
  throw new Error("PayGate asset does not match Arc USDC.");
}
if (authorizedPayer.toLowerCase() !== payer.address.toLowerCase()) {
  throw new Error(
    `PayGate payer ${authorizedPayer} does not match role ${payerRole} (${payer.address}).`,
  );
}
if (authorizedAgent.toLowerCase() !== signer.address.toLowerCase()) {
  throw new Error(
    `Registry signer ${authorizedAgent} does not match role ${signerRole} (${signer.address}).`,
  );
}
if (splitId >= splitCount) {
  throw new Error(
    `PAY_GATE_TEST_SPLIT_ID ${splitId} is outside split count ${splitCount}.`,
  );
}
const split = await publicClient.readContract({
  address: FEE_ROUTER_ADDRESS,
  abi: feeRouterAbi,
  functionName: "splitAt",
  args: [splitId],
});
const [balance, allowance] = await Promise.all([
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
    args: [payer.address, payGate],
  }),
]);

if (!execute) {
  console.log(
    JSON.stringify(
      {
        chainId: ARC_CHAIN_ID,
        payGate,
        registry,
        feeRouter,
        usdc,
        authorizedAgent,
        signerRole,
        authorizedPayer,
        payerRole,
        splitId: splitId.toString(),
        recipients: split.recipients,
        amountAtomicUsdc: amount.toString(),
        payerBalanceAtomicUsdc: balance.toString(),
        payerAllowanceAtomicUsdc: allowance.toString(),
        execute: false,
        nextStep:
          "Use a fresh PayGate with zero payer allowance, then set PAY_GATE_TEST_EXECUTE=1 to run the on-chain assertions.",
      },
      null,
      2,
    ),
  );
} else {
  if (balance < amount) {
    throw new Error("PayGate test payer has insufficient USDC asset balance.");
  }
  if (allowance !== 0n) {
    throw new Error(
      "PayGate no-allowance assertion requires a fresh deployment with zero payer allowance.",
    );
  }

  const now = BigInt(Math.floor(Date.now() / 1000));
  const nonceBase = BigInt(Date.now());
  const expiredNonce = await nextUnusedNonce(publicClient, registry, nonceBase);
  const overCapNonce = await nextUnusedNonce(
    publicClient,
    registry,
    expiredNonce + 1n,
  );
  const invalidSignatureNonce = await nextUnusedNonce(
    publicClient,
    registry,
    overCapNonce + 1n,
  );
  const noAllowanceNonce = await nextUnusedNonce(
    publicClient,
    registry,
    invalidSignatureNonce + 1n,
  );
  const validNonce = await nextUnusedNonce(
    publicClient,
    registry,
    noAllowanceNonce + 1n,
  );
  const payments = [{ splitId, amount }];

  const expiredIntent = intent(now - 3600n, expiredNonce, amount);
  const expiredSignature = await signer.account.signTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: expiredIntent,
  });
  await expectSimulationRevert(
    publicClient,
    {
      address: payGate,
      abi: payGateAbi,
      functionName: "payWithIntent",
      args: [expiredIntent, expiredSignature, payments],
      account: payer.address,
      chain: arcTestnet,
    },
    "intent expired",
    "Expired intent",
  );

  const overCapIntent = intent(now + 600n, overCapNonce, amount - 1n);
  const overCapSignature = await signer.account.signTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: overCapIntent,
  });
  await expectSimulationRevert(
    publicClient,
    {
      address: payGate,
      abi: payGateAbi,
      functionName: "payWithIntent",
      args: [overCapIntent, overCapSignature, payments],
      account: payer.address,
      chain: arcTestnet,
    },
    "spend exceeds intent max",
    "Over-cap intent",
  );

  const invalidSignatureIntent = intent(
    now + 600n,
    invalidSignatureNonce,
    amount,
  );
  const invalidSignature = await privateKeyToAccount(
    generatePrivateKey(),
  ).signTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: invalidSignatureIntent,
  });
  await expectSimulationRevert(
    publicClient,
    {
      address: payGate,
      abi: payGateAbi,
      functionName: "payWithIntent",
      args: [invalidSignatureIntent, invalidSignature, payments],
      account: payer.address,
      chain: arcTestnet,
    },
    "invalid intent signer",
    "Invalid intent signer",
  );

  const noAllowanceIntent = intent(now + 600n, noAllowanceNonce, amount);
  const noAllowanceSignature = await signer.account.signTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: noAllowanceIntent,
  });
  await expectSimulationRevert(
    publicClient,
    {
      address: payGate,
      abi: payGateAbi,
      functionName: "payWithIntent",
      args: [noAllowanceIntent, noAllowanceSignature, payments],
      account: "0x000000000000000000000000000000000000dEaD",
      chain: arcTestnet,
    },
    "invalid payer",
    "Unauthorized payer",
  );
  await expectSimulationRevert(
    publicClient,
    {
      address: payGate,
      abi: payGateAbi,
      functionName: "payWithIntent",
      args: [noAllowanceIntent, noAllowanceSignature, payments],
      account: payer.address,
      chain: arcTestnet,
    },
    "transfer amount exceeds allowance",
    "No-allowance payment",
  );

  const approvalTx = await walletClient.writeContract({
    address: ARC_USDC,
    abi: usdcAbi,
    functionName: "approve",
    args: [payGate, amount],
    account: payer.account,
    chain: arcTestnet,
  });
  await waitForSuccessfulTransaction(
    publicClient,
    approvalTx,
    "PayGate approval transaction",
  );

  const expectedByRecipient = new Map();
  let allocated = 0n;
  for (let index = 1; index < split.recipients.length; index += 1) {
    const portion = (amount * BigInt(split.bps[index])) / 10_000n;
    const recipient = split.recipients[index];
    expectedByRecipient.set(
      recipient,
      (expectedByRecipient.get(recipient) ?? 0n) + portion,
    );
    allocated += portion;
  }
  const firstRecipient = split.recipients[0];
  expectedByRecipient.set(
    firstRecipient,
    (expectedByRecipient.get(firstRecipient) ?? 0n) + amount - allocated,
  );
  const recipientEntry = [...expectedByRecipient.entries()].find(
    ([, expectedDelta]) => expectedDelta > 0n,
  );
  if (!recipientEntry) {
    throw new Error(
      "PayGate test split has no recipient with a positive payout.",
    );
  }
  const [recipient, expectedDelta] = recipientEntry;
  const claimableBefore = await publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterAbi,
    functionName: "claimableOf",
    args: [splitId, recipient],
  });

  const validIntent = intent(now + 600n, validNonce, amount);
  const signature = await signer.account.signTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: validIntent,
  });
  const digest = hashTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: validIntent,
  });
  const simulation = await publicClient.simulateContract({
    address: payGate,
    abi: payGateAbi,
    functionName: "payWithIntent",
    args: [validIntent, signature, payments],
    account: payer.address,
    chain: arcTestnet,
  });
  if (simulation.result.toLowerCase() !== digest.toLowerCase()) {
    throw new Error("PayGate simulation returned an unexpected intent digest.");
  }
  const payTx = await walletClient.writeContract({
    ...simulation.request,
    account: payer.account,
  });
  const receipt = await waitForSuccessfulTransaction(
    publicClient,
    payTx,
    "PayGate payment transaction",
  );
  const [used, claimableAfter] = await Promise.all([
    publicClient.readContract({
      address: registry,
      abi: registryAbi,
      functionName: "usedNonces",
      args: [validNonce],
    }),
    publicClient.readContract({
      address: FEE_ROUTER_ADDRESS,
      abi: feeRouterAbi,
      functionName: "claimableOf",
      args: [splitId, recipient],
    }),
  ]);
  if (!used) throw new Error("Registry did not mark the PayGate nonce used.");
  if (claimableAfter - claimableBefore !== expectedDelta) {
    throw new Error(
      "FeeRouter claimable delta differs from the routed amount.",
    );
  }
  const expectedLogs = hasExpectedLogs(receipt, {
    registry,
    queryHash: validIntent.queryHash,
    digest,
    agent: authorizedAgent,
    splitId,
    payGate,
    payer: payer.address,
    amount,
  });
  if (!expectedLogs.anchor || !expectedLogs.routed || !expectedLogs.paid) {
    throw new Error(
      "PayGate transaction is missing an expected contract event.",
    );
  }
  await expectSimulationRevert(
    publicClient,
    {
      address: payGate,
      abi: payGateAbi,
      functionName: "payWithIntent",
      args: [validIntent, signature, payments],
      account: payer.address,
      chain: arcTestnet,
    },
    "intent nonce used",
    "Reused nonce",
  );

  console.log(
    JSON.stringify(
      {
        chainId: ARC_CHAIN_ID,
        payGate,
        registry,
        feeRouter,
        usdc,
        authorizedAgent,
        authorizedPayer,
        splitId: splitId.toString(),
        recipient,
        amountAtomicUsdc: amount.toString(),
        digest,
        nonce: validNonce.toString(),
        approvalTx,
        payTx,
        blockNumber: receipt.blockNumber.toString(),
        expiredIntentRejected: true,
        overCapIntentRejected: true,
        invalidSignatureRejected: true,
        unauthorizedPayerRejected: true,
        noAllowanceRejected: true,
        reusedNonceRejected: true,
        eventsVerified: true,
        claimableDeltaAtomicUsdc: expectedDelta.toString(),
      },
      null,
      2,
    ),
  );
}
