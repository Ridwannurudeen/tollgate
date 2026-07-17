import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
require("../lib/arc.js");

const RECIPIENT = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const USDC = "0x3333333333333333333333333333333333333333";
const FEE_ROUTER = "0x4444444444444444444444444444444444444444";
const TRANSACTION_HASHES = {
  approve: `0x${"a".repeat(64)}`,
  createSplit: `0x${"b".repeat(64)}`,
  pay: `0x${"c".repeat(64)}`,
};
const REPLACEMENT_HASH = `0x${"d".repeat(64)}`;
const splitCreatedAbi = [
  {
    type: "event",
    name: "SplitCreated",
    inputs: [
      { name: "splitId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "recipients", type: "address[]", indexed: false },
      { name: "bps", type: "uint16[]", indexed: false },
    ],
  },
];

function memStorage() {
  const map = new Map();
  return {
    get: async (key) => (map.has(key) ? map.get(key) : null),
    set: async (key, value) => {
      map.set(key, value);
    },
  };
}

function loadFeeRouter(publicClient, walletClient) {
  const viem = require("viem");
  const accounts = require("viem/accounts");
  const viemDescriptors = new Map(
    ["createPublicClient", "createWalletClient", "http"].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(viem, name),
    ]),
  );
  const accountDescriptor = Object.getOwnPropertyDescriptor(
    accounts,
    "privateKeyToAccount",
  );
  const feeRouterPath = require.resolve("../lib/fee-router.js");

  try {
    Object.defineProperties(viem, {
      createPublicClient: {
        configurable: true,
        value: () => publicClient,
      },
      createWalletClient: {
        configurable: true,
        value: () => walletClient,
      },
      http: {
        configurable: true,
        value: () => ({}),
      },
    });
    Object.defineProperty(accounts, "privateKeyToAccount", {
      configurable: true,
      value: () => ({ address: PAYER }),
    });
    delete require.cache[feeRouterPath];
    return require(feeRouterPath);
  } finally {
    for (const [name, descriptor] of viemDescriptors) {
      Object.defineProperty(viem, name, descriptor);
    }
    Object.defineProperty(accounts, "privateKeyToAccount", accountDescriptor);
    delete require.cache[feeRouterPath];
  }
}

function splitCreatedLog(splitId) {
  const { encodeAbiParameters, encodeEventTopics } = require("viem");
  return {
    address: FEE_ROUTER,
    topics: encodeEventTopics({
      abi: splitCreatedAbi,
      eventName: "SplitCreated",
      args: { splitId, creator: PAYER },
    }),
    data: encodeAbiParameters(
      [
        { name: "recipients", type: "address[]" },
        { name: "bps", type: "uint16[]" },
      ],
      [[RECIPIENT], [10_000]],
    ),
  };
}

function mockClients(stage, receiptOutcome, eventSplitId = 19n) {
  const writes = [];
  const paidSplitIds = [];
  const publicClient = {
    readContract: async ({ functionName }) => {
      if (functionName === "balanceOf") return 1_000_000n;
      if (functionName === "allowance") {
        return stage === "approve" ? 0n : 1_000_000n;
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async (request) => ({
      result: 19n,
      request,
    }),
    waitForTransactionReceipt: async ({ hash }) => {
      const currentStage = Object.entries(TRANSACTION_HASHES).find(
        ([, transactionHash]) => transactionHash === hash,
      )?.[0];
      return currentStage === stage
        ? receiptOutcome(hash)
        : {
            status: "success",
            transactionHash: hash,
            logs:
              currentStage === "createSplit"
                ? [splitCreatedLog(eventSplitId)]
                : [],
          };
    },
  };
  const walletClient = {
    writeContract: async ({ functionName, args }) => {
      writes.push(functionName);
      if (functionName === "pay") paidSplitIds.push(args[0]);
      return TRANSACTION_HASHES[functionName];
    },
  };
  return { publicClient, walletClient, writes, paidSplitIds };
}

test("routeCreatorPayment pays the split id emitted by the mined createSplit transaction", async () => {
  const storage = memStorage();
  const { publicClient, walletClient, paidSplitIds } = mockClients(
    "none",
    () => {
      throw new Error("unused");
    },
    23n,
  );
  const { routeCreatorPayment } = loadFeeRouter(publicClient, walletClient);

  const evidence = await routeCreatorPayment({
    recipient: RECIPIENT,
    amountAtomicUsdc: 2500,
    privateKey: "test-operator-key",
    chainId: 5_042_002,
    rpcUrl: "http://127.0.0.1:8545",
    usdc: USDC,
    feeRouter: FEE_ROUTER,
    storage,
  });

  assert.deepEqual(paidSplitIds, [23n]);
  assert.equal(evidence.feeRouterSplitId, "23");
});

for (const stage of ["approve", "createSplit", "pay"]) {
  for (const receiptCase of [
    {
      name: "reverted",
      outcome: (hash) => ({ status: "reverted", transactionHash: hash }),
    },
    {
      name: "replaced",
      outcome: () => ({
        status: "success",
        transactionHash: REPLACEMENT_HASH,
      }),
    },
  ]) {
    test(`routeCreatorPayment rejects a ${receiptCase.name} ${stage} receipt without returning settlement evidence`, async () => {
      const storage = memStorage();
      const { publicClient, walletClient, writes } = mockClients(
        stage,
        receiptCase.outcome,
      );
      const { routeCreatorPayment, SPLITS_KEY } = loadFeeRouter(
        publicClient,
        walletClient,
      );

      await assert.rejects(
        routeCreatorPayment({
          recipient: RECIPIENT,
          amountAtomicUsdc: 2500,
          privateKey: "test-operator-key",
          chainId: 5_042_002,
          rpcUrl: "http://127.0.0.1:8545",
          usdc: USDC,
          feeRouter: FEE_ROUTER,
          storage,
        }),
        new RegExp(`FeeRouter ${stage} transaction`),
      );

      assert.deepEqual(
        writes,
        stage === "approve"
          ? ["approve"]
          : stage === "createSplit"
            ? ["createSplit"]
            : ["createSplit", "pay"],
      );
      if (stage !== "pay") {
        assert.equal(await storage.get(SPLITS_KEY), null);
      }
    });
  }
}
