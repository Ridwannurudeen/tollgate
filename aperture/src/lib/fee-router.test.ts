import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  FEE_ROUTER_ADDRESS,
  readFeeRouterSplitRegistry,
  routeLicensePayment,
} from "./fee-router";

// A throwaway key generated at runtime — used only to derive a payer address
// locally (no network, never funded).
const TEST_KEY = generatePrivateKey();

const RECIPIENT = "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03";
const OTHER_RECIPIENT = "0x96e7168e5299df21370c1cf4310432c273604547";
const SPLIT_CREATED_EVENT_ABI = [
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
] as const;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

type ContractCall = {
  functionName: string;
  args?: readonly unknown[];
  account?: unknown;
};

type TransactionStage = "approve" | "createSplit" | "pay";

type ReceiptOutcome = {
  status: "success" | "reverted";
  transactionHash?: Hex;
};

type MinedSplit = {
  splitId?: bigint;
  creator?: Address;
  recipients?: Address[];
  bps?: number[];
};

function splitCreatedLog(
  splitId: bigint,
  creator: Address,
  recipients: Address[],
  bps: number[],
) {
  return {
    address: FEE_ROUTER_ADDRESS,
    topics: encodeEventTopics({
      abi: SPLIT_CREATED_EVENT_ABI,
      eventName: "SplitCreated",
      args: { splitId, creator },
    }),
    data: encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint16[]" }],
      [recipients, bps],
    ),
  };
}

function accountAddress(value: unknown): string | null {
  if (!value || typeof value !== "object" || !("address" in value)) {
    return null;
  }
  const address = (value as { address?: unknown }).address;
  return typeof address === "string" ? address : null;
}

function mockClients(
  allowance: bigint,
  createSplitId: bigint,
  writes: string[],
  paidSplitIds: bigint[] = [],
  createSplitAccounts: unknown[] = [],
  receiptOutcomes: Partial<Record<TransactionStage, ReceiptOutcome>> = {},
  minedSplit: MinedSplit = {},
) {
  const transactionStages = new Map<Hex, TransactionStage>();
  const publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return 1_000_000n;
      if (functionName === "allowance") return allowance;
      if (functionName === "splitAt") {
        return {
          creator: RECIPIENT,
          recipients: [RECIPIENT],
          bps: [10_000],
          totalRouted: 0n,
          createdAt: 1n,
        };
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async (request: ContractCall) => ({
      result: createSplitId,
      request: {
        ...request,
        account: "0x4164F5B52ecc6F847f03071A287b0B59954cbcEe",
      },
    }),
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const stage = transactionStages.get(hash);
      const outcome = stage ? receiptOutcomes[stage] : undefined;
      return {
        status: outcome?.status ?? "success",
        transactionHash: outcome?.transactionHash ?? hash,
        logs:
          stage === "createSplit" && outcome?.status !== "reverted"
            ? [
                splitCreatedLog(
                  minedSplit.splitId ?? createSplitId,
                  minedSplit.creator ?? privateKeyToAccount(TEST_KEY).address,
                  minedSplit.recipients ?? [RECIPIENT],
                  minedSplit.bps ?? [10_000],
                ),
              ]
            : [],
      };
    },
  } as unknown as PublicClient;
  const walletClient = {
    writeContract: async ({ functionName, args, account }: ContractCall) => {
      writes.push(functionName);
      if (functionName === "createSplit") {
        createSplitAccounts.push(account);
      }
      if (functionName === "pay" && typeof args?.[0] === "bigint") {
        paidSplitIds.push(args[0]);
      }
      const txByte =
        functionName === "approve"
          ? "a"
          : functionName === "createSplit"
            ? "b"
            : "c";
      const transactionHash = `0x${txByte.repeat(64)}` as Hex;
      if (
        functionName === "approve" ||
        functionName === "createSplit" ||
        functionName === "pay"
      ) {
        transactionStages.set(transactionHash, functionName);
      }
      return transactionHash;
    },
  } as unknown as WalletClient;
  return { publicClient, walletClient };
}

describe("routeLicensePayment", () => {
  it("returns null when FeeRouter settlement is disabled", async () => {
    await expect(
      routeLicensePayment(RECIPIENT, 2500, { enabled: false }),
    ).resolves.toBeNull();
  });

  it("requires a private key when enabled", async () => {
    const originalApertureKey = process.env.APERTURE_FEE_ROUTER_PRIVATE_KEY;
    const originalFacilitatorKey = process.env.FACILITATOR_PRIVATE_KEY;
    delete process.env.APERTURE_FEE_ROUTER_PRIVATE_KEY;
    delete process.env.FACILITATOR_PRIVATE_KEY;

    try {
      await expect(
        routeLicensePayment(RECIPIENT, 2500, { enabled: true }),
      ).rejects.toThrow("APERTURE_FEE_ROUTER_PRIVATE_KEY");
    } finally {
      restoreEnv("APERTURE_FEE_ROUTER_PRIVATE_KEY", originalApertureKey);
      restoreEnv("FACILITATOR_PRIVATE_KEY", originalFacilitatorKey);
    }
  });

  it("uses the facilitator key fallback when a dedicated Aperture key is absent", async () => {
    const originalApertureKey = process.env.APERTURE_FEE_ROUTER_PRIVATE_KEY;
    const originalFacilitatorKey = process.env.FACILITATOR_PRIVATE_KEY;
    delete process.env.APERTURE_FEE_ROUTER_PRIVATE_KEY;
    process.env.FACILITATOR_PRIVATE_KEY = TEST_KEY;

    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const createSplitAccounts: unknown[] = [];
    const { publicClient, walletClient } = mockClients(
      1_000_000n,
      61n,
      writes,
      [],
      createSplitAccounts,
    );

    try {
      const evidence = await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(evidence?.settlementMode).toBe("forum-routed");
      expect(accountAddress(createSplitAccounts[0])).toBe(
        privateKeyToAccount(TEST_KEY).address,
      );
    } finally {
      restoreEnv("APERTURE_FEE_ROUTER_PRIVATE_KEY", originalApertureKey);
      restoreEnv("FACILITATOR_PRIVATE_KEY", originalFacilitatorKey);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("settles via approve/createSplit/pay and pays the mined split id", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const createSplitAccounts: unknown[] = [];
    const { publicClient, walletClient } = mockClients(
      0n,
      77n,
      writes,
      paidSplitIds,
      createSplitAccounts,
    );

    try {
      const evidence = await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["approve", "createSplit", "pay"]);
      expect(paidSplitIds).toEqual([77n]);
      expect(accountAddress(createSplitAccounts[0])).toBe(
        privateKeyToAccount(TEST_KEY).address,
      );
      expect(evidence?.settlementMode).toBe("forum-routed");
      expect(evidence?.feeRouterSplitId).toBe("77");
      expect(evidence?.feeRouterPayTx).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the split id from the mined SplitCreated event when the prediction races", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const { publicClient, walletClient } = mockClients(
      1_000_000n,
      77n,
      writes,
      paidSplitIds,
      [],
      {},
      { splitId: 78n },
    );

    try {
      const evidence = await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["createSplit", "pay"]);
      expect(paidSplitIds).toEqual([78n]);
      expect(evidence?.feeRouterSplitId).toBe("78");
      await expect(
        readFeeRouterSplitRegistry(registryPath),
      ).resolves.toMatchObject({
        splits: [{ splitId: "78" }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  for (const [field, minedSplit] of [
    ["creator", { creator: OTHER_RECIPIENT }],
    ["recipient", { recipients: [OTHER_RECIPIENT] }],
    ["bps", { bps: [9_000] }],
  ] satisfies [string, MinedSplit][]) {
    it(`rejects a SplitCreated event with a mismatched ${field}`, async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
      const registryPath = path.join(dir, "fee-router-splits.json");
      const writes: string[] = [];
      const { publicClient, walletClient } = mockClients(
        1_000_000n,
        77n,
        writes,
        [],
        [],
        {},
        minedSplit,
      );

      try {
        await expect(
          routeLicensePayment(RECIPIENT, 2500, {
            enabled: true,
            privateKey: TEST_KEY,
            publicClient,
            walletClient,
            splitRegistryPath: registryPath,
          }),
        ).rejects.toThrow(
          "FeeRouter SplitCreated event does not match the requested creator split.",
        );

        expect(writes).toEqual(["createSplit"]);
        await expect(readFeeRouterSplitRegistry(registryPath)).resolves.toEqual(
          { splits: [] },
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  it("skips the approve when allowance already covers the amount", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const { publicClient, walletClient } = mockClients(1_000_000n, 7n, writes);

    try {
      await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["createSplit", "pay"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reuses the persisted split for repeat creator payouts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
    const registryPath = path.join(dir, "fee-router-splits.json");
    const writes: string[] = [];
    const paidSplitIds: bigint[] = [];
    const { publicClient, walletClient } = mockClients(
      1_000_000n,
      81n,
      writes,
      paidSplitIds,
    );

    try {
      await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });
      await routeLicensePayment(RECIPIENT, 2500, {
        enabled: true,
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        splitRegistryPath: registryPath,
      });

      expect(writes).toEqual(["createSplit", "pay", "pay"]);
      expect(paidSplitIds).toEqual([81n, 81n]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  for (const stage of ["approve", "createSplit", "pay"] as const) {
    for (const receiptCase of [
      {
        name: "reverted",
        outcome: (hash: Hex): ReceiptOutcome => ({
          status: "reverted",
          transactionHash: hash,
        }),
      },
      {
        name: "replaced",
        outcome: (): ReceiptOutcome => ({
          status: "success",
          transactionHash: `0x${"d".repeat(64)}`,
        }),
      },
    ]) {
      it(`rejects a ${receiptCase.name} ${stage} receipt without returning settlement evidence`, async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), "aperture-splits-"));
        const registryPath = path.join(dir, "fee-router-splits.json");
        const writes: string[] = [];
        const transactionByte =
          stage === "approve" ? "a" : stage === "createSplit" ? "b" : "c";
        const transactionHash = `0x${transactionByte.repeat(64)}` as Hex;
        const { publicClient, walletClient } = mockClients(
          stage === "approve" ? 0n : 1_000_000n,
          91n,
          writes,
          [],
          [],
          { [stage]: receiptCase.outcome(transactionHash) },
        );

        try {
          await expect(
            routeLicensePayment(RECIPIENT, 2500, {
              enabled: true,
              privateKey: TEST_KEY,
              publicClient,
              walletClient,
              splitRegistryPath: registryPath,
            }),
          ).rejects.toThrow(`FeeRouter ${stage} transaction`);

          expect(writes).toEqual(
            stage === "approve"
              ? ["approve"]
              : stage === "createSplit"
                ? ["createSplit"]
                : ["createSplit", "pay"],
          );
          if (stage !== "pay") {
            await expect(
              readFeeRouterSplitRegistry(registryPath),
            ).resolves.toEqual({ splits: [] });
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      });
    }
  }
});
