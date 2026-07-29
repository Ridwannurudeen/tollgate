import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  hashTypedData,
  http,
  isAddress,
} from "viem";
import { loadWallet } from "./wallet-keystore.mjs";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC_URL =
  process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const execute = process.env.USE_RECEIPT_REGISTRY_TEST_EXECUTE === "1";
const registryAddress = process.env.LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS;

const arcChain = defineChain({
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

const registryAbi = [
  {
    type: "function",
    name: "anchor",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: useIntentTypes.TollgateUseIntent,
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
  {
    type: "function",
    name: "hashIntent",
    stateMutability: "view",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: useIntentTypes.TollgateUseIntent,
      },
    ],
    outputs: [{ name: "digest", type: "bytes32" }],
  },
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
    outputs: [{ name: "", type: "address" }],
  },
];

function domain(address) {
  return {
    name: "Tollgate UseReceipt Registry",
    version: "1",
    chainId: ARC_CHAIN_ID,
    verifyingContract: address,
  };
}

function intent(expiry, nonce) {
  return {
    queryHash: `0x${"1".repeat(64)}`,
    candidateSetRoot: `0x${"2".repeat(64)}`,
    selectedSourcesRoot: `0x${"3".repeat(64)}`,
    decisionTraceHash: `0x${"4".repeat(64)}`,
    claimSupportRoot: `0x${"5".repeat(64)}`,
    maxSpendAtomicUsdc: 6_500n,
    expiry,
    nonce,
  };
}

async function expectSimulationRevert(publicClient, request, label) {
  try {
    await publicClient.simulateContract(request);
  } catch {
    return;
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

if (!registryAddress || !isAddress(registryAddress)) {
  throw new Error(
    "LEPTONWEB_USE_RECEIPT_REGISTRY_ADDRESS must name the deployed registry.",
  );
}
const registry = getAddress(registryAddress);
const role = process.env.LEPTONWEB_USE_INTENT_DEPLOYER_ROLE ?? "tollgate-agent-payee";
const wallet = await loadWallet(role);
const publicClient = createPublicClient({
  chain: arcChain,
  transport: http(ARC_RPC_URL),
});
const walletClient = createWalletClient({
  account: wallet.account,
  chain: arcChain,
  transport: http(ARC_RPC_URL),
});
const authorizedAgent = await publicClient.readContract({
  address: registry,
  abi: registryAbi,
  functionName: "tollgateAgentWallet",
});
if (authorizedAgent.toLowerCase() !== wallet.address.toLowerCase()) {
  throw new Error(
    `Registry signer ${authorizedAgent} does not match role ${role} (${wallet.address}).`,
  );
}

if (!execute) {
  console.log(
    JSON.stringify(
      {
        chainId: ARC_CHAIN_ID,
        registry,
        authorizedAgent,
        execute: false,
        nextStep:
          "Set USE_RECEIPT_REGISTRY_TEST_EXECUTE=1 to run expiry, anchor, and nonce-reuse assertions.",
      },
      null,
      2,
    ),
  );
} else {
  let nonce = BigInt(Date.now());
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
  const now = BigInt(Math.floor(Date.now() / 1000));
  // Well in the past so the check holds even though block.timestamp lags
  // the local clock by a few seconds.
  const expiredIntent = intent(now - 3600n, nonce);
  const expiredSignature = await wallet.account.signTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: expiredIntent,
  });
  await expectSimulationRevert(
    publicClient,
    {
      address: registry,
      abi: registryAbi,
      functionName: "anchor",
      args: [expiredIntent, expiredSignature],
      account: wallet.address,
      chain: arcChain,
    },
    "Expired intent",
  );

  const validIntent = intent(now + 600n, nonce);
  const signature = await wallet.account.signTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: validIntent,
  });
  const localDigest = hashTypedData({
    domain: domain(registry),
    types: useIntentTypes,
    primaryType: "TollgateUseIntent",
    message: validIntent,
  });
  const contractDigest = await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "hashIntent",
    args: [validIntent],
  });
  if (contractDigest.toLowerCase() !== localDigest.toLowerCase()) {
    throw new Error("Contract and client intent digests differ.");
  }
  const { request } = await publicClient.simulateContract({
    address: registry,
    abi: registryAbi,
    functionName: "anchor",
    args: [validIntent, signature],
    account: wallet.address,
    chain: arcChain,
  });
  const anchorTx = await walletClient.writeContract({
    ...request,
    account: wallet.account,
  });
  await publicClient.waitForTransactionReceipt({ hash: anchorTx });
  const used = await publicClient.readContract({
    address: registry,
    abi: registryAbi,
    functionName: "usedNonces",
    args: [nonce],
  });
  if (!used) throw new Error("Registry did not mark the anchored nonce used.");
  await expectSimulationRevert(
    publicClient,
    {
      address: registry,
      abi: registryAbi,
      functionName: "anchor",
      args: [validIntent, signature],
      account: wallet.address,
      chain: arcChain,
    },
    "Reused nonce",
  );

  console.log(
    JSON.stringify(
      {
        chainId: ARC_CHAIN_ID,
        registry,
        authorizedAgent,
        digest: localDigest,
        nonce: nonce.toString(),
        anchorTx,
        expiredIntentRejected: true,
        reusedNonceRejected: true,
      },
      null,
      2,
    ),
  );
}
