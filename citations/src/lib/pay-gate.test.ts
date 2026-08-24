import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ARC_USDC } from "./chain";
import { createQueryRecord } from "./engine";
import {
  planCitationPayments,
  type FeeRouterWalletClient,
  type FeeRouterWriteContractRequest,
} from "./fee-router";
import { FEE_ROUTER_ADDRESS, feeRouterV1Abi } from "./fee-router-contract";
import { resetFeeRouterNonceStateForTests } from "./fee-router-nonce";
import {
  assertPayGatePaymentsWithinIntent,
  payCitationsWithIntent,
  payGateAbi,
  payGateAddress,
} from "./pay-gate";
import type { BuiltUseIntent, TollgateUseIntent } from "./use-intent";

const PAY_GATE = "0x1111111111111111111111111111111111111111";
const REGISTRY = "0x2222222222222222222222222222222222222222";
const PRIVATE_KEY = generatePrivateKey();
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const APPROVAL_TX = `0x${"a".repeat(64)}` as Hex;
const CREATE_SPLIT_TX = `0x${"b".repeat(64)}` as Hex;
const PAY_GATE_TX = `0x${"c".repeat(64)}` as Hex;
let previousPayGate: string | undefined;
let previousEscrow: string | undefined;

function intent(maxSpendAtomicUsdc: bigint): TollgateUseIntent {
  return {
    queryHash: `0x${"1".repeat(64)}`,
    candidateSetRoot: `0x${"2".repeat(64)}`,
    selectedSourcesRoot: `0x${"3".repeat(64)}`,
    decisionTraceHash: `0x${"4".repeat(64)}`,
    claimSupportRoot: `0x${"5".repeat(64)}`,
    maxSpendAtomicUsdc,
    expiry: 1_900_000_000n,
    nonce: 7n,
  };
}

beforeEach(() => {
  previousPayGate = process.env.LEPTONWEB_PAYGATE_ADDRESS;
  previousEscrow = process.env.TOLLGATE_ESCROW_UNVERIFIED;
  delete process.env.LEPTONWEB_PAYGATE_ADDRESS;
  delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
  resetFeeRouterNonceStateForTests();
});

function builtIntent(
  queryHash: Hex,
  maxSpendAtomicUsdc: bigint,
): BuiltUseIntent {
  const built = intent(maxSpendAtomicUsdc);
  built.queryHash = queryHash;
  return {
    intent: built,
    digest: `0x${"6".repeat(64)}`,
    plannedSpendAtomicUsdc: Number(maxSpendAtomicUsdc),
    registryAddress: REGISTRY,
    chainId: 5_042_002,
  };
}

function mockClients(
  built: BuiltUseIntent,
  writes: FeeRouterWriteContractRequest[],
  payGateReceipt: { status: "success" | "reverted"; transactionHash: Hex } = {
    status: "success",
    transactionHash: PAY_GATE_TX,
  },
) {
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "registry") return REGISTRY;
      if (functionName === "feeRouter") return FEE_ROUTER_ADDRESS;
      if (functionName === "usdc") return ARC_USDC;
      if (functionName === "payer") return ACCOUNT.address;
      if (functionName === "balanceOf") return 1_000_000n;
      if (functionName === "allowance") return 0n;
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async (request: FeeRouterWriteContractRequest) => ({
      result: 19n,
      request,
    }),
    getTransactionCount: async () => 30,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      if (hash === CREATE_SPLIT_TX) {
        const request = writes.find(
          (write) => write.functionName === "createSplit",
        );
        const recipients = request?.args?.[0] as Address[];
        const bps = request?.args?.[1] as number[];
        return {
          status: "success",
          transactionHash: hash,
          logs: [
            {
              address: FEE_ROUTER_ADDRESS,
              topics: encodeEventTopics({
                abi: feeRouterV1Abi,
                eventName: "SplitCreated",
                args: { splitId: 19n, creator: ACCOUNT.address },
              }),
              data: encodeAbiParameters(
                [{ type: "address[]" }, { type: "uint16[]" }],
                [recipients, bps],
              ),
            },
          ],
        };
      }
      if (hash !== PAY_GATE_TX) {
        return { status: "success", transactionHash: hash, logs: [] };
      }
      const total = built.intent.maxSpendAtomicUsdc;
      return {
        ...payGateReceipt,
        logs: [
          {
            address: PAY_GATE,
            topics: encodeEventTopics({
              abi: payGateAbi,
              eventName: "PaidWithIntent",
              args: {
                queryHash: built.intent.queryHash,
                digest: built.digest,
                payer: ACCOUNT.address,
              },
            }),
            data: encodeAbiParameters([{ type: "uint256" }], [total]),
          },
        ],
      };
    },
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async (request: FeeRouterWriteContractRequest) => {
      writes.push(request);
      if (request.functionName === "approve") return APPROVAL_TX;
      if (request.functionName === "createSplit") return CREATE_SPLIT_TX;
      if (request.functionName === "payWithIntent") return PAY_GATE_TX;
      throw new Error(`unexpected write ${request.functionName}`);
    },
  } as FeeRouterWalletClient;
  return { publicClient, walletClient };
}

afterEach(() => {
  if (previousPayGate === undefined) {
    delete process.env.LEPTONWEB_PAYGATE_ADDRESS;
  } else {
    process.env.LEPTONWEB_PAYGATE_ADDRESS = previousPayGate;
  }
  if (previousEscrow === undefined) {
    delete process.env.TOLLGATE_ESCROW_UNVERIFIED;
  } else {
    process.env.TOLLGATE_ESCROW_UNVERIFIED = previousEscrow;
  }
});

describe("PayGate configuration and planning", () => {
  it("is disabled only when the PayGate address is unset or blank", () => {
    expect(payGateAddress()).toBeNull();
    process.env.LEPTONWEB_PAYGATE_ADDRESS = "  ";
    expect(payGateAddress()).toBeNull();

    process.env.LEPTONWEB_PAYGATE_ADDRESS = PAY_GATE;
    expect(payGateAddress()).toBe(PAY_GATE);

    process.env.LEPTONWEB_PAYGATE_ADDRESS = "not-an-address";
    expect(() => payGateAddress()).toThrow(
      "LEPTONWEB_PAYGATE_ADDRESS must be a 20-byte EVM address",
    );
  });

  it("uses the shared routing plan for payouts, refunds, and escrow", () => {
    const query = createQueryRecord(
      "How should PayGate route creator evidence?",
      "2026-07-12T12:00:00.000Z",
    );
    query.citations = query.citations.slice(0, 1);
    query.totalAtomicUsdc = query.citations[0]?.amountAtomicUsdc ?? 0;
    const base = query.citations[0];
    if (!base) throw new Error("missing fixture citation");
    query.citations = [
      { ...base, sourceId: "routed", payoutAtomicUsdc: 60 },
      { ...base, sourceId: "refunded", payoutPolicy: "refund-unused" },
      {
        ...base,
        sourceId: "escrowed",
        sourceKind: "external",
        verifiedCreator: false,
      },
    ];

    const plan = planCitationPayments(query);

    expect(plan.payments).toEqual([
      expect.objectContaining({ sourceId: "routed", amountAtomicUsdc: 60 }),
    ]);
    expect(plan.evidenceBySourceId.refunded).toMatchObject({
      settlementMode: "refunded",
      payoutPolicy: "refund-unused",
    });
    expect(plan.evidenceBySourceId.escrowed).toMatchObject({
      settlementMode: "escrowed",
      payoutPolicy: "escrow-unverified",
    });
  });

  it("rejects empty, zero, and over-cap payment batches before submission", () => {
    expect(() => assertPayGatePaymentsWithinIntent([], intent(100n))).toThrow(
      "PayGate requires at least one payment",
    );
    expect(() =>
      assertPayGatePaymentsWithinIntent([{ amount: 0n }], intent(100n)),
    ).toThrow("PayGate payment amounts must be positive");
    expect(() =>
      assertPayGatePaymentsWithinIntent(
        [{ amount: 60n }, { amount: 50n }],
        intent(100n),
      ),
    ).toThrow("PayGate spend 110 exceeds max 100 atomic USDC");
    expect(
      assertPayGatePaymentsWithinIntent(
        [{ amount: 60n }, { amount: 40n }],
        intent(100n),
      ),
    ).toBe(100n);
  });

  it("submits approval, split creation, and one atomic PayGate settlement", async () => {
    const query = createQueryRecord(
      "How should PayGate route creator evidence?",
      "2026-07-12T12:00:00.000Z",
    );
    query.citations = query.citations.slice(0, 1);
    query.totalAtomicUsdc = query.citations[0]?.amountAtomicUsdc ?? 0;
    const built = builtIntent(
      query.queryHash as Hex,
      BigInt(query.totalAtomicUsdc),
    );
    const writes: FeeRouterWriteContractRequest[] = [];
    const clients = mockClients(built, writes);
    const dir = await mkdtemp(path.join(os.tmpdir(), "pay-gate-splits-"));

    try {
      const result = await payCitationsWithIntent(
        query,
        built,
        `0x${"7".repeat(130)}` as Hex,
        {
          address: PAY_GATE as Address,
          enabled: true,
          privateKey: PRIVATE_KEY,
          publicClient: clients.publicClient,
          walletClient: clients.walletClient,
          splitRegistryPath: path.join(dir, "splits.json"),
        },
      );

      expect(writes.map((write) => write.functionName)).toEqual([
        "approve",
        "createSplit",
        "payWithIntent",
      ]);
      expect(writes[0]?.args).toEqual([PAY_GATE, 1_000_000n]);
      expect(writes.map((write) => write.nonce)).toEqual([30, 31, 32]);
      expect(result.transaction).toBe(PAY_GATE_TX);
      expect(Object.values(result.evidenceBySourceId)).toEqual([
        expect.objectContaining({
          settlementMode: "forum-routed",
          payer: ACCOUNT.address,
          feeRouterSplitId: "19",
          feeRouterPayTx: PAY_GATE_TX,
        }),
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a batch above the allowance ceiling before writing", async () => {
    const query = createQueryRecord(
      "How should PayGate route creator evidence?",
      "2026-07-12T12:00:00.000Z",
    );
    const citation = query.citations[0];
    if (!citation) throw new Error("missing fixture citation");
    query.citations = [
      { ...citation, payoutAtomicUsdc: 1_000_001 },
    ];
    query.totalAtomicUsdc = 1_000_001;
    const built = builtIntent(query.queryHash as Hex, 1_000_001n);
    const writes: FeeRouterWriteContractRequest[] = [];
    const clients = mockClients(built, writes);

    await expect(
      payCitationsWithIntent(query, built, `0x${"7".repeat(130)}` as Hex, {
        address: PAY_GATE as Address,
        enabled: true,
        privateKey: PRIVATE_KEY,
        publicClient: clients.publicClient,
        walletClient: clients.walletClient,
      }),
    ).rejects.toThrow("exceeds the FeeRouter allowance ceiling");
    expect(writes).toEqual([]);
  });

  it("rejects reverted and replaced PayGate receipts", async () => {
    const query = createQueryRecord(
      "How should PayGate route creator evidence?",
      "2026-07-12T12:00:00.000Z",
    );
    query.citations = query.citations.slice(0, 1);
    query.totalAtomicUsdc = query.citations[0]?.amountAtomicUsdc ?? 0;
    const built = builtIntent(
      query.queryHash as Hex,
      BigInt(query.totalAtomicUsdc),
    );
    const cases = [
      {
        receipt: { status: "reverted" as const, transactionHash: PAY_GATE_TX },
        message: "PayGate settlement transaction failed with status reverted",
      },
      {
        receipt: {
          status: "success" as const,
          transactionHash: `0x${"d".repeat(64)}` as Hex,
        },
        message: "PayGate settlement transaction was replaced",
      },
    ];

    for (const item of cases) {
      resetFeeRouterNonceStateForTests();
      const writes: FeeRouterWriteContractRequest[] = [];
      const clients = mockClients(built, writes, item.receipt);
      const dir = await mkdtemp(path.join(os.tmpdir(), "pay-gate-splits-"));
      try {
        await expect(
          payCitationsWithIntent(query, built, `0x${"7".repeat(130)}` as Hex, {
            address: PAY_GATE as Address,
            enabled: true,
            privateKey: PRIVATE_KEY,
            publicClient: clients.publicClient,
            walletClient: clients.walletClient,
            splitRegistryPath: path.join(dir, "splits.json"),
          }),
        ).rejects.toThrow(item.message);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});
