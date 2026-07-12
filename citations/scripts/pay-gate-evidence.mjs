import {
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  keccak256,
  toHex,
} from "viem";
import { confirmedReceiptPosition } from "./transaction-order.mjs";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const HEX_DATA_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

export const tollgateUseIntentComponents = [
  { name: "queryHash", type: "bytes32" },
  { name: "candidateSetRoot", type: "bytes32" },
  { name: "selectedSourcesRoot", type: "bytes32" },
  { name: "decisionTraceHash", type: "bytes32" },
  { name: "claimSupportRoot", type: "bytes32" },
  { name: "maxSpendAtomicUsdc", type: "uint256" },
  { name: "expiry", type: "uint256" },
  { name: "nonce", type: "uint256" },
];

export const payGateAbi = [
  {
    type: "function",
    name: "payWithIntent",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "intent",
        type: "tuple",
        components: tollgateUseIntentComponents,
      },
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
    type: "event",
    name: "PaidWithIntent",
    inputs: [
      { name: "queryHash", type: "bytes32", indexed: true },
      { name: "digest", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "total", type: "uint256", indexed: false },
    ],
  },
];

export const useIntentAnchoredEventAbi = [
  {
    type: "event",
    name: "UseIntentAnchored",
    inputs: [
      { name: "queryHash", type: "bytes32", indexed: true },
      { name: "digest", type: "bytes32", indexed: true },
      { name: "signer", type: "address", indexed: true },
    ],
  },
];

export const feeRouterRoutedEventAbi = [
  {
    type: "event",
    name: "Routed",
    inputs: [
      { name: "splitId", type: "uint256", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
];

export const feeRouterSplitAtAbi = [
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
];

export const USE_INTENT_ANCHORED_TOPIC = keccak256(
  toHex("UseIntentAnchored(bytes32,bytes32,address)"),
).toLowerCase();
export const PAY_GATE_PAID_WITH_INTENT_TOPIC = keccak256(
  toHex("PaidWithIntent(bytes32,bytes32,address,uint256)"),
).toLowerCase();
export const FEE_ROUTER_ROUTED_TOPIC = keccak256(
  toHex("Routed(uint256,address,uint256)"),
).toLowerCase();

export const PAY_GATE_GETTER_SELECTORS = {
  registry: keccak256(toHex("registry()")).slice(0, 10),
  feeRouter: keccak256(toHex("feeRouter()")).slice(0, 10),
  usdc: keccak256(toHex("usdc()")).slice(0, 10),
  payer: keccak256(toHex("payer()")).slice(0, 10),
};

function assertRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is missing or malformed`);
  }
  return value;
}

function normalizedAddress(value, label) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    throw new Error(`${label} is not an EVM address`);
  }
  return value.toLowerCase();
}

function normalizedBytes32(value, label) {
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) {
    throw new Error(`${label} is not bytes32`);
  }
  return value.toLowerCase();
}

function normalizedSignature(value) {
  if (typeof value !== "string" || !SIGNATURE_PATTERN.test(value)) {
    throw new Error("intent signature is not 65 bytes");
  }
  return value.toLowerCase();
}

function normalizedHexData(value, label) {
  if (typeof value !== "string" || !HEX_DATA_PATTERN.test(value)) {
    throw new Error(`${label} is not hex data`);
  }
  return value.toLowerCase();
}

function unsignedInteger(value, label) {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`${label} is negative`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label} is not a non-negative safe integer`);
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error(`${label} is not an unsigned integer`);
}

function canonicalIntent(value, label) {
  const record = assertRecord(value, label);
  return {
    queryHash: normalizedBytes32(record.queryHash, `${label}.queryHash`),
    candidateSetRoot: normalizedBytes32(
      record.candidateSetRoot,
      `${label}.candidateSetRoot`,
    ),
    selectedSourcesRoot: normalizedBytes32(
      record.selectedSourcesRoot,
      `${label}.selectedSourcesRoot`,
    ),
    decisionTraceHash: normalizedBytes32(
      record.decisionTraceHash,
      `${label}.decisionTraceHash`,
    ),
    claimSupportRoot: normalizedBytes32(
      record.claimSupportRoot,
      `${label}.claimSupportRoot`,
    ),
    maxSpendAtomicUsdc: unsignedInteger(
      record.maxSpendAtomicUsdc,
      `${label}.maxSpendAtomicUsdc`,
    ),
    expiry: unsignedInteger(record.expiry, `${label}.expiry`),
    nonce: unsignedInteger(record.nonce, `${label}.nonce`),
  };
}

function sameIntent(left, right) {
  return Object.keys(left).every((field) => left[field] === right[field]);
}

function paymentKey(splitId, amount) {
  return `${splitId.toString()}:${amount.toString()}`;
}

function paymentCounts(payments) {
  const counts = new Map();
  for (const payment of payments) {
    const key = paymentKey(payment.splitId, payment.amount);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function samePaymentMultiset(left, right) {
  if (left.length !== right.length) return false;
  const leftCounts = paymentCounts(left);
  const rightCounts = paymentCounts(right);
  if (leftCounts.size !== rightCounts.size) return false;
  return Array.from(leftCounts.entries()).every(
    ([key, count]) => rightCounts.get(key) === count,
  );
}

function verifyPaymentSplit(record, index) {
  const wallet = normalizedAddress(record.wallet, `payment ${index} wallet`);
  const contributors = record.contributors;
  let expectedRecipients;
  let expectedBps;
  if (contributors === undefined || contributors.length === 0) {
    expectedRecipients = [wallet];
    expectedBps = [10_000n];
  } else {
    if (!Array.isArray(contributors)) {
      throw new Error(`payment ${index} contributors are malformed`);
    }
    expectedRecipients = contributors.map((contributor, contributorIndex) => {
      const value = assertRecord(
        contributor,
        `payment ${index} contributor ${contributorIndex}`,
      );
      return normalizedAddress(
        value.wallet,
        `payment ${index} contributor ${contributorIndex} wallet`,
      );
    });
    expectedBps = contributors.map((contributor, contributorIndex) =>
      unsignedInteger(
        contributor.shareBps,
        `payment ${index} contributor ${contributorIndex} shareBps`,
      ),
    );
  }
  if (expectedBps.reduce((sum, value) => sum + value, 0n) !== 10_000n) {
    throw new Error(`payment ${index} contributor BPS do not sum to 10000`);
  }
  const split = assertRecord(
    decodeFunctionResult({
      abi: feeRouterSplitAtAbi,
      functionName: "splitAt",
      data: normalizedHexData(
        record.splitAtResult,
        `payment ${index} splitAtResult`,
      ),
    }),
    `payment ${index} splitAt result`,
  );
  if (!Array.isArray(split.recipients) || !Array.isArray(split.bps)) {
    throw new Error(`payment ${index} splitAt result is malformed`);
  }
  const actualRecipients = split.recipients.map((recipient, recipientIndex) =>
    normalizedAddress(
      recipient,
      `payment ${index} split recipient ${recipientIndex}`,
    ),
  );
  const actualBps = split.bps.map((bps, bpsIndex) =>
    unsignedInteger(bps, `payment ${index} split BPS ${bpsIndex}`),
  );
  if (
    actualRecipients.length !== expectedRecipients.length ||
    actualRecipients.some(
      (recipient, recipientIndex) =>
        recipient !== expectedRecipients[recipientIndex],
    ) ||
    actualBps.length !== expectedBps.length ||
    actualBps.some((bps, bpsIndex) => bps !== expectedBps[bpsIndex])
  ) {
    throw new Error(
      `payment ${index} FeeRouter split does not match ledger recipients`,
    );
  }
}

function eventLogs(receipt, address, topic) {
  if (!Array.isArray(receipt.logs)) {
    throw new Error("transaction receipt has no log list");
  }
  return receipt.logs.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const logAddress =
      typeof value.address === "string" ? value.address.toLowerCase() : null;
    const firstTopic =
      Array.isArray(value.topics) && typeof value.topics[0] === "string"
        ? value.topics[0].toLowerCase()
        : null;
    return logAddress === address && firstTopic === topic;
  });
}

function decodedEvent(log, abi, eventName, transactionHash) {
  const record = assertRecord(log, `${eventName} log`);
  if (
    normalizedBytes32(
      record.transactionHash,
      `${eventName} log transactionHash`,
    ) !== transactionHash
  ) {
    throw new Error(`${eventName} log has a different transaction hash`);
  }
  if (!Array.isArray(record.topics)) {
    throw new Error(`${eventName} log has malformed topics`);
  }
  return decodeEventLog({
    abi,
    eventName,
    data: normalizedHexData(record.data, `${eventName} log data`),
    topics: record.topics,
    strict: true,
  });
}

function failure(error) {
  return {
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  };
}

export function verifyPayGateEvidence(input) {
  try {
    const value = assertRecord(input, "PayGate evidence");
    const payGateAddress = normalizedAddress(
      value.payGateAddress,
      "PayGate address",
    );
    const registryAddress = normalizedAddress(
      value.registryAddress,
      "Registry address",
    );
    const feeRouterAddress = normalizedAddress(
      value.feeRouterAddress,
      "FeeRouter address",
    );
    const expectedPayer = normalizedAddress(
      value.payerAddress,
      "PayGate authorized payer",
    );
    const transactionHash = normalizedBytes32(
      value.transactionHash,
      "PayGate transaction hash",
    );
    const digest = normalizedBytes32(value.digest, "intent digest");
    const signer = normalizedAddress(value.signer, "intent signer");
    const signature = normalizedSignature(value.signature);
    const intent = canonicalIntent(value.intent, "expected intent");
    if (!Array.isArray(value.payments) || value.payments.length === 0) {
      throw new Error("PayGate evidence has no routed payments");
    }

    const payments = value.payments.map((payment, index) => {
      const record = assertRecord(payment, `payment ${index}`);
      const paymentTransaction = normalizedBytes32(
        record.transactionHash,
        `payment ${index} transactionHash`,
      );
      if (paymentTransaction !== transactionHash) {
        throw new Error(
          `payment ${index} does not share the PayGate transaction`,
        );
      }
      if (
        normalizedBytes32(
          record.evidenceTransactionHash,
          `payment ${index} evidenceTransactionHash`,
        ) !== transactionHash
      ) {
        throw new Error(
          `payment ${index} generic evidence does not share the PayGate transaction`,
        );
      }
      const payer = normalizedAddress(record.payer, `payment ${index} payer`);
      if (payer !== expectedPayer) {
        throw new Error(
          "FeeRouter payment evidence does not name the external payer",
        );
      }
      verifyPaymentSplit(record, index);
      const amount = unsignedInteger(
        record.amountAtomicUsdc,
        `payment ${index} amountAtomicUsdc`,
      );
      if (amount === 0n) {
        throw new Error(`payment ${index} amount is zero`);
      }
      return {
        splitId: unsignedInteger(record.splitId, `payment ${index} splitId`),
        amount,
      };
    });
    const total = payments.reduce((sum, payment) => sum + payment.amount, 0n);
    if (total > intent.maxSpendAtomicUsdc) {
      throw new Error("PayGate payment total exceeds the intent maximum");
    }

    const transaction = assertRecord(value.transaction, "PayGate transaction");
    if (
      normalizedBytes32(transaction.hash, "transaction.hash") !==
      transactionHash
    ) {
      throw new Error("PayGate transaction record has a different hash");
    }
    if (
      normalizedAddress(transaction.to, "transaction.to") !== payGateAddress
    ) {
      throw new Error(
        "PayGate transaction target does not match the stored address",
      );
    }
    if (
      normalizedAddress(transaction.from, "transaction.from") !== expectedPayer
    ) {
      throw new Error(
        "PayGate transaction sender does not match its authorized payer",
      );
    }
    const receipt = assertRecord(value.receipt, "PayGate receipt");
    if (!confirmedReceiptPosition(receipt, transactionHash)) {
      throw new Error(
        "PayGate transaction receipt is not confirmed and successful",
      );
    }

    const decodedCall = decodeFunctionData({
      abi: payGateAbi,
      data: normalizedHexData(transaction.input, "transaction.input"),
    });
    if (decodedCall.functionName !== "payWithIntent") {
      throw new Error("PayGate transaction did not call payWithIntent");
    }
    const callArgs = decodedCall.args;
    if (!Array.isArray(callArgs) || callArgs.length !== 3) {
      throw new Error("PayGate calldata has malformed arguments");
    }
    if (!sameIntent(canonicalIntent(callArgs[0], "calldata intent"), intent)) {
      throw new Error("PayGate calldata intent does not match the ledger");
    }
    if (normalizedSignature(callArgs[1]) !== signature) {
      throw new Error("PayGate calldata signature does not match the ledger");
    }
    if (!Array.isArray(callArgs[2])) {
      throw new Error("PayGate calldata has no payment list");
    }
    const calldataPayments = callArgs[2].map((payment, index) => {
      const record = assertRecord(payment, `calldata payment ${index}`);
      return {
        splitId: unsignedInteger(
          record.splitId,
          `calldata payment ${index} splitId`,
        ),
        amount: unsignedInteger(
          record.amount,
          `calldata payment ${index} amount`,
        ),
      };
    });
    if (!samePaymentMultiset(calldataPayments, payments)) {
      throw new Error("PayGate calldata payments do not match the ledger");
    }

    const registryLogs = eventLogs(
      receipt,
      registryAddress,
      USE_INTENT_ANCHORED_TOPIC,
    );
    if (registryLogs.length !== 1) {
      throw new Error("PayGate receipt must contain one Registry anchor event");
    }
    const anchored = decodedEvent(
      registryLogs[0],
      useIntentAnchoredEventAbi,
      "UseIntentAnchored",
      transactionHash,
    ).args;
    if (
      normalizedBytes32(anchored.queryHash, "anchor queryHash") !==
        intent.queryHash ||
      normalizedBytes32(anchored.digest, "anchor digest") !== digest ||
      normalizedAddress(anchored.signer, "anchor signer") !== signer
    ) {
      throw new Error("Registry anchor event does not match the signed intent");
    }

    const paidLogs = eventLogs(
      receipt,
      payGateAddress,
      PAY_GATE_PAID_WITH_INTENT_TOPIC,
    );
    if (paidLogs.length !== 1) {
      throw new Error("PayGate receipt must contain one PaidWithIntent event");
    }
    const paid = decodedEvent(
      paidLogs[0],
      payGateAbi,
      "PaidWithIntent",
      transactionHash,
    ).args;
    if (
      normalizedBytes32(paid.queryHash, "paid queryHash") !==
        intent.queryHash ||
      normalizedBytes32(paid.digest, "paid digest") !== digest ||
      normalizedAddress(paid.payer, "paid payer") !== expectedPayer ||
      unsignedInteger(paid.total, "paid total") !== total
    ) {
      throw new Error("PaidWithIntent event does not match the ledger");
    }

    const routedLogs = eventLogs(
      receipt,
      feeRouterAddress,
      FEE_ROUTER_ROUTED_TOPIC,
    );
    if (routedLogs.length !== payments.length) {
      throw new Error("FeeRouter Routed event count does not match the ledger");
    }
    const routedPayments = routedLogs.map((log) => {
      const routed = decodedEvent(
        log,
        feeRouterRoutedEventAbi,
        "Routed",
        transactionHash,
      ).args;
      if (normalizedAddress(routed.payer, "Routed payer") !== payGateAddress) {
        throw new Error("FeeRouter Routed payer is not PayGate");
      }
      return {
        splitId: unsignedInteger(routed.splitId, "Routed splitId"),
        amount: unsignedInteger(routed.amount, "Routed amount"),
      };
    });
    if (!samePaymentMultiset(routedPayments, payments)) {
      throw new Error("FeeRouter Routed events do not match the ledger");
    }

    return { ok: true, totalAtomicUsdc: total.toString() };
  } catch (error) {
    return failure(error);
  }
}

function decodedAddressWord(value, label) {
  if (typeof value !== "string" || !/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label} did not return an ABI-encoded address`);
  }
  return `0x${value.slice(-40).toLowerCase()}`;
}

export function verifyPayGateConfigurationEvidence(input) {
  try {
    const value = assertRecord(input, "PayGate configuration evidence");
    normalizedAddress(value.payGateAddress, "PayGate address");
    const registryAddress = normalizedAddress(
      value.registryAddress,
      "Registry address",
    );
    const feeRouterAddress = normalizedAddress(
      value.feeRouterAddress,
      "FeeRouter address",
    );
    const usdcAddress = normalizedAddress(value.usdcAddress, "USDC address");
    const expectedPayer = normalizedAddress(
      value.payerAddress,
      "PayGate authorized payer",
    );
    if (
      typeof value.code !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})+$/.test(value.code) ||
      /^0x(?:00)+$/.test(value.code)
    ) {
      throw new Error("PayGate address has no deployed runtime bytecode");
    }
    if (
      decodedAddressWord(value.registryResult, "registry()") !== registryAddress
    ) {
      throw new Error("PayGate registry() does not match the intent Registry");
    }
    if (
      decodedAddressWord(value.feeRouterResult, "feeRouter()") !==
      feeRouterAddress
    ) {
      throw new Error("PayGate feeRouter() does not match FeeRouter");
    }
    if (decodedAddressWord(value.usdcResult, "usdc()") !== usdcAddress) {
      throw new Error("PayGate usdc() does not match Arc USDC");
    }
    if (decodedAddressWord(value.payerResult, "payer()") !== expectedPayer) {
      throw new Error("PayGate payer() does not match the transaction sender");
    }
    return { ok: true, payerAddress: expectedPayer };
  } catch (error) {
    return failure(error);
  }
}
