import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  type Abi,
  type Hex,
} from "viem";
import { beforeAll, describe, expect, it } from "vitest";

type EvidenceResult = {
  ok: boolean;
  detail?: string;
  totalAtomicUsdc?: string;
};

type EvidenceModule = {
  payGateAbi: Abi;
  useIntentAnchoredEventAbi: Abi;
  feeRouterRoutedEventAbi: Abi;
  verifyPayGateEvidence(input: unknown): EvidenceResult;
  verifyPayGateConfigurationEvidence(input: unknown): EvidenceResult;
};

type Intent = {
  queryHash: Hex;
  candidateSetRoot: Hex;
  selectedSourcesRoot: Hex;
  decisionTraceHash: Hex;
  claimSupportRoot: Hex;
  maxSpendAtomicUsdc: bigint;
  expiry: bigint;
  nonce: bigint;
};

type Payment = {
  splitId: string;
  amountAtomicUsdc: number;
  transactionHash: Hex;
  evidenceTransactionHash: Hex;
  payer: Hex;
  wallet: Hex;
  contributors?: Array<{ wallet: Hex; shareBps: number }>;
  splitAtResult: Hex;
};

type RpcLog = {
  address: Hex;
  topics: Hex[];
  data: Hex;
  transactionHash: Hex;
};

type Fixture = {
  payGateAddress: Hex;
  registryAddress: Hex;
  feeRouterAddress: Hex;
  transactionHash: Hex;
  transaction: {
    hash: Hex;
    to: Hex;
    from: Hex;
    input: Hex;
  };
  receipt: {
    status: string;
    transactionHash: Hex;
    blockHash: Hex;
    blockNumber: string;
    transactionIndex: string;
    logs: RpcLog[];
  };
  intent: Intent;
  signature: Hex;
  digest: Hex;
  signer: Hex;
  payerAddress: Hex;
  payments: Payment[];
};

const PAY_GATE = "0x1111111111111111111111111111111111111111";
const REGISTRY = "0x2222222222222222222222222222222222222222";
const FEE_ROUTER = "0x3333333333333333333333333333333333333333";
const PAYER = "0x4444444444444444444444444444444444444444";
const SIGNER = "0x5555555555555555555555555555555555555555";
const OTHER = "0x6666666666666666666666666666666666666666";
const TRANSACTION = `0x${"a".repeat(64)}` as Hex;
const OTHER_TRANSACTION = `0x${"b".repeat(64)}` as Hex;
const BLOCK_HASH = `0x${"c".repeat(64)}` as Hex;
const DIGEST = `0x${"d".repeat(64)}` as Hex;
const SIGNATURE = `0x${"e".repeat(130)}` as Hex;
const CREATOR_A = "0x7777777777777777777777777777777777777777";
const CONTRIBUTOR_A = "0x8888888888888888888888888888888888888888";
const CONTRIBUTOR_B = "0x9999999999999999999999999999999999999999";
const FEE_ROUTER_SPLIT_AT_ABI = [
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
] as const;

const INTENT: Intent = {
  queryHash: `0x${"1".repeat(64)}`,
  candidateSetRoot: `0x${"2".repeat(64)}`,
  selectedSourcesRoot: `0x${"3".repeat(64)}`,
  decisionTraceHash: `0x${"4".repeat(64)}`,
  claimSupportRoot: `0x${"5".repeat(64)}`,
  maxSpendAtomicUsdc: 3_500n,
  expiry: 2_000_000_000n,
  nonce: 17n,
};

const EVIDENCE_URL = pathToFileURL(
  path.join(process.cwd(), "scripts", "pay-gate-evidence.mjs"),
).href;

let evidence: EvidenceModule;

beforeAll(async () => {
  evidence = (await import(EVIDENCE_URL)) as unknown as EvidenceModule;
});

function encodeInput(
  intent: Intent,
  signature: Hex,
  payments: Array<{ splitId: bigint; amount: bigint }>,
): Hex {
  return encodeFunctionData({
    abi: evidence.payGateAbi,
    functionName: "payWithIntent",
    args: [intent, signature, payments],
  });
}

function encodedTopics(value: unknown): Hex[] {
  if (
    !Array.isArray(value) ||
    !value.every(
      (topic): topic is Hex =>
        typeof topic === "string" && /^0x[0-9a-fA-F]*$/.test(topic),
    )
  ) {
    throw new Error("Event topic encoding returned malformed topics.");
  }
  return value;
}

function registryLog(
  queryHash: Hex = INTENT.queryHash,
  digest: Hex = DIGEST,
  signer: Hex = SIGNER,
): RpcLog {
  return {
    address: REGISTRY,
    topics: encodedTopics(
      encodeEventTopics({
        abi: evidence.useIntentAnchoredEventAbi,
        eventName: "UseIntentAnchored",
        args: { queryHash, digest, signer },
      }),
    ),
    data: "0x",
    transactionHash: TRANSACTION,
  };
}

function paidLog(total: bigint = 3_000n, payer: Hex = PAYER): RpcLog {
  return {
    address: PAY_GATE,
    topics: encodedTopics(
      encodeEventTopics({
        abi: evidence.payGateAbi,
        eventName: "PaidWithIntent",
        args: {
          queryHash: INTENT.queryHash,
          digest: DIGEST,
          payer,
        },
      }),
    ),
    data: encodeAbiParameters([{ type: "uint256" }], [total]),
    transactionHash: TRANSACTION,
  };
}

function routedLog(
  splitId: bigint,
  amount: bigint,
  payer: Hex = PAY_GATE,
): RpcLog {
  return {
    address: FEE_ROUTER,
    topics: encodedTopics(
      encodeEventTopics({
        abi: evidence.feeRouterRoutedEventAbi,
        eventName: "Routed",
        args: { splitId, payer },
      }),
    ),
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    transactionHash: TRANSACTION,
  };
}

function splitAtResult(recipients: Hex[], bps: number[]): Hex {
  return encodeFunctionResult({
    abi: FEE_ROUTER_SPLIT_AT_ABI,
    functionName: "splitAt",
    result: {
      creator: PAYER,
      recipients,
      bps,
      totalRouted: 3_000n,
      createdAt: 1n,
    },
  });
}

function buildFixture(): Fixture {
  const contractPayments = [
    { splitId: 7n, amount: 1_000n },
    { splitId: 9n, amount: 2_000n },
  ];
  return {
    payGateAddress: PAY_GATE,
    registryAddress: REGISTRY,
    feeRouterAddress: FEE_ROUTER,
    transactionHash: TRANSACTION,
    transaction: {
      hash: TRANSACTION,
      to: PAY_GATE,
      from: PAYER,
      input: encodeInput({ ...INTENT }, SIGNATURE, contractPayments),
    },
    receipt: {
      status: "0x1",
      transactionHash: TRANSACTION,
      blockHash: BLOCK_HASH,
      blockNumber: "0x10",
      transactionIndex: "0x2",
      logs: [
        registryLog(),
        ...contractPayments.map((payment) =>
          routedLog(payment.splitId, payment.amount),
        ),
        paidLog(),
      ],
    },
    intent: { ...INTENT },
    signature: SIGNATURE,
    digest: DIGEST,
    signer: SIGNER,
    payerAddress: PAYER,
    payments: [
      {
        splitId: contractPayments[0].splitId.toString(),
        amountAtomicUsdc: Number(contractPayments[0].amount),
        transactionHash: TRANSACTION,
        evidenceTransactionHash: TRANSACTION,
        payer: PAYER,
        wallet: CREATOR_A,
        splitAtResult: splitAtResult([CREATOR_A], [10_000]),
      },
      {
        splitId: contractPayments[1].splitId.toString(),
        amountAtomicUsdc: Number(contractPayments[1].amount),
        transactionHash: TRANSACTION,
        evidenceTransactionHash: TRANSACTION,
        payer: PAYER,
        wallet: CONTRIBUTOR_A,
        contributors: [
          { wallet: CONTRIBUTOR_A, shareBps: 7_000 },
          { wallet: CONTRIBUTOR_B, shareBps: 3_000 },
        ],
        splitAtResult: splitAtResult(
          [CONTRIBUTOR_A, CONTRIBUTOR_B],
          [7_000, 3_000],
        ),
      },
    ],
  };
}

function addressWord(address: Hex): Hex {
  return `0x${"0".repeat(24)}${address.slice(2)}`;
}

describe("PayGate transaction evidence", () => {
  it("accepts an exact successful outer transaction with multiple payouts", () => {
    expect(evidence.verifyPayGateEvidence(buildFixture())).toEqual({
      ok: true,
      totalAtomicUsdc: "3000",
    });
  });

  it("fails closed on target, sender, receipt, calldata, cap, and shared-hash mutations", () => {
    const mutations: Array<(fixture: Fixture) => void> = [
      (fixture) => {
        fixture.transaction.to = OTHER;
      },
      (fixture) => {
        fixture.transaction.from = OTHER;
      },
      (fixture) => {
        fixture.receipt.status = "0x0";
      },
      (fixture) => {
        fixture.receipt.transactionHash = OTHER_TRANSACTION;
      },
      (fixture) => {
        fixture.transaction.input = "0xdeadbeef";
      },
      (fixture) => {
        fixture.transaction.input = encodeInput(
          { ...fixture.intent, queryHash: `0x${"f".repeat(64)}` },
          fixture.signature,
          [
            { splitId: 7n, amount: 1_000n },
            { splitId: 9n, amount: 2_000n },
          ],
        );
      },
      (fixture) => {
        fixture.transaction.input = encodeInput(
          fixture.intent,
          `0x${"f".repeat(130)}`,
          [
            { splitId: 7n, amount: 1_000n },
            { splitId: 9n, amount: 2_000n },
          ],
        );
      },
      (fixture) => {
        fixture.transaction.input = encodeInput(
          fixture.intent,
          fixture.signature,
          [
            { splitId: 7n, amount: 1_001n },
            { splitId: 9n, amount: 1_999n },
          ],
        );
      },
      (fixture) => {
        fixture.intent.maxSpendAtomicUsdc = 2_999n;
        fixture.transaction.input = encodeInput(
          fixture.intent,
          fixture.signature,
          [
            { splitId: 7n, amount: 1_000n },
            { splitId: 9n, amount: 2_000n },
          ],
        );
      },
      (fixture) => {
        fixture.payments[1].transactionHash = OTHER_TRANSACTION;
      },
      (fixture) => {
        fixture.payments[1].evidenceTransactionHash = OTHER_TRANSACTION;
      },
      (fixture) => {
        fixture.payments[1].payer = OTHER;
      },
    ];

    for (const mutate of mutations) {
      const fixture = buildFixture();
      mutate(fixture);
      expect(evidence.verifyPayGateEvidence(fixture).ok).toBe(false);
    }
  });

  it("fails closed on missing or mismatched Registry and PayGate events", () => {
    const mutations: Array<(fixture: Fixture) => void> = [
      (fixture) => {
        fixture.receipt.logs.splice(0, 1);
      },
      (fixture) => {
        fixture.receipt.logs[0] = registryLog(
          INTENT.queryHash,
          `0x${"f".repeat(64)}`,
        );
      },
      (fixture) => {
        fixture.receipt.logs[0] = registryLog(INTENT.queryHash, DIGEST, OTHER);
      },
      (fixture) => {
        fixture.receipt.logs.splice(3, 1);
      },
      (fixture) => {
        fixture.receipt.logs[3] = paidLog(2_999n);
      },
      (fixture) => {
        fixture.receipt.logs[3] = paidLog(3_000n, OTHER);
      },
      (fixture) => {
        fixture.receipt.logs.push(paidLog());
      },
    ];

    for (const mutate of mutations) {
      const fixture = buildFixture();
      mutate(fixture);
      expect(evidence.verifyPayGateEvidence(fixture).ok).toBe(false);
    }
  });

  it("requires the exact FeeRouter Routed event multiset with PayGate as payer", () => {
    const mutations: Array<(fixture: Fixture) => void> = [
      (fixture) => {
        fixture.receipt.logs.splice(2, 1);
      },
      (fixture) => {
        fixture.receipt.logs.push(routedLog(9n, 2_000n));
      },
      (fixture) => {
        fixture.receipt.logs[1] = routedLog(7n, 999n);
      },
      (fixture) => {
        fixture.receipt.logs[1] = routedLog(8n, 1_000n);
      },
      (fixture) => {
        fixture.receipt.logs[1] = routedLog(7n, 1_000n, PAYER);
      },
      (fixture) => {
        fixture.receipt.logs[1].address = OTHER;
      },
      (fixture) => {
        fixture.receipt.logs[1].transactionHash = OTHER_TRANSACTION;
      },
    ];

    for (const mutate of mutations) {
      const fixture = buildFixture();
      mutate(fixture);
      expect(evidence.verifyPayGateEvidence(fixture).ok).toBe(false);
    }
  });

  it("binds every FeeRouter split to the ledger creator recipients and BPS", () => {
    const mutations: Array<(fixture: Fixture) => void> = [
      (fixture) => {
        fixture.payments[0].wallet = OTHER;
      },
      (fixture) => {
        fixture.payments[1].contributors![0].shareBps = 6_000;
      },
      (fixture) => {
        fixture.payments[0].splitAtResult = splitAtResult([OTHER], [10_000]);
      },
      (fixture) => {
        fixture.payments[1].splitAtResult = splitAtResult(
          [CONTRIBUTOR_A, CONTRIBUTOR_B],
          [6_000, 4_000],
        );
      },
    ];

    for (const mutate of mutations) {
      const fixture = buildFixture();
      mutate(fixture);
      expect(evidence.verifyPayGateEvidence(fixture).ok).toBe(false);
    }
  });
});

describe("PayGate deployed configuration evidence", () => {
  function configuration() {
    return {
      payGateAddress: PAY_GATE,
      registryAddress: REGISTRY,
      feeRouterAddress: FEE_ROUTER,
      usdcAddress: OTHER,
      payerAddress: PAYER,
      code: "0x60006000",
      registryResult: addressWord(REGISTRY),
      feeRouterResult: addressWord(FEE_ROUTER),
      usdcResult: addressWord(OTHER),
      payerResult: addressWord(PAYER),
    };
  }

  it("accepts deployed bytecode with exact immutable wiring", () => {
    expect(
      evidence.verifyPayGateConfigurationEvidence(configuration()),
    ).toEqual({ ok: true, payerAddress: PAYER });
  });

  it("rejects missing bytecode and every mismatched immutable", () => {
    const mutations: Array<(value: ReturnType<typeof configuration>) => void> =
      [
        (value) => {
          value.code = "0x";
        },
        (value) => {
          value.registryResult = addressWord(OTHER);
        },
        (value) => {
          value.feeRouterResult = addressWord(OTHER);
        },
        (value) => {
          value.usdcResult = addressWord(REGISTRY);
        },
        (value) => {
          value.payerResult = addressWord(OTHER);
        },
      ];

    for (const mutate of mutations) {
      const value = configuration();
      mutate(value);
      expect(evidence.verifyPayGateConfigurationEvidence(value).ok).toBe(false);
    }
  });
});
