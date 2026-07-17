import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const clients = vi.hoisted(() => ({
  publicClient: undefined as unknown,
  walletClient: undefined as unknown,
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => clients.publicClient,
    createWalletClient: () => clients.walletClient,
  };
});

import { loadConfig, type SidecarConfig } from "../src/config.js";
import { createFeeRouterAdapter } from "../src/fee-router.js";

const TEST_KEY = generatePrivateKey();
const RECIPIENT = "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03";
const APPROVAL_TX = `0x${"a".repeat(64)}` as Hex;
const CREATE_SPLIT_TX = `0x${"b".repeat(64)}` as Hex;
const PAY_TX = `0x${"c".repeat(64)}` as Hex;
const REPLACEMENT_TX = `0x${"d".repeat(64)}` as Hex;
const LIVE_VERIFICATION_ENV = {
  JELLYFIN_SERVER_URL: "http://127.0.0.1:8096",
  JELLYFIN_API_KEY: "server-api-key",
} as const;
const FEE_ROUTER_ADDRESS =
  "0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59" as Address;
const OTHER_ADDRESS =
  "0x96e7168e5299df21370c1cf4310432c273604547" as Address;
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

function liveAdapterConfig(dir: string): SidecarConfig {
  return {
    ...loadConfig(
      {
        JELLYFIN_FEE_ROUTER_SPLIT_REGISTRY_PATH: path.join(
          dir,
          "fee-router-splits.json",
        ),
      },
      dir,
    ),
    feeRouterMode: "live",
    feeRouterPrivateKey: TEST_KEY,
    jellyfinServerUrl: LIVE_VERIFICATION_ENV.JELLYFIN_SERVER_URL,
    jellyfinApiKey: LIVE_VERIFICATION_ENV.JELLYFIN_API_KEY,
  };
}

type TransactionStage = "approval" | "createSplit" | "pay";
type ReceiptFailure = "reverted" | "replaced";

type MinedSplit = {
  splitId?: bigint;
  address?: Address;
  creator?: Address;
  recipients?: Address[];
  bps?: number[];
  eventCount?: number;
};

type ClientOptions = {
  failureStage?: TransactionStage;
  failure?: ReceiptFailure;
  simulatedSplitId?: bigint;
  minedSplit?: MinedSplit;
  paidSplitIds?: bigint[];
};

function splitCreatedLog(splitId: bigint, minedSplit: MinedSplit) {
  return {
    address: minedSplit.address ?? FEE_ROUTER_ADDRESS,
    topics: encodeEventTopics({
      abi: SPLIT_CREATED_EVENT_ABI,
      eventName: "SplitCreated",
      args: {
        splitId,
        creator:
          minedSplit.creator ?? privateKeyToAccount(TEST_KEY).address,
      },
    }),
    data: encodeAbiParameters(
      [{ type: "address[]" }, { type: "uint16[]" }],
      [
        minedSplit.recipients ?? [RECIPIENT],
        minedSplit.bps ?? [10_000],
      ],
    ),
  };
}

function stageForTransaction(hash: Hex): TransactionStage {
  if (hash === APPROVAL_TX) return "approval";
  if (hash === CREATE_SPLIT_TX) return "createSplit";
  if (hash === PAY_TX) return "pay";
  throw new Error(`unexpected transaction ${hash}`);
}

function transactionForFunction(functionName: string): Hex {
  if (functionName === "approve") return APPROVAL_TX;
  if (functionName === "createSplit") return CREATE_SPLIT_TX;
  if (functionName === "pay") return PAY_TX;
  throw new Error(`unexpected write ${functionName}`);
}

function installClients({
  failureStage,
  failure,
  simulatedSplitId = 42n,
  minedSplit = {},
  paidSplitIds = [],
}: ClientOptions = {}): void {
  clients.publicClient = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "balanceOf") return 1_000_000n;
      if (functionName === "allowance") return 0n;
      throw new Error(`unexpected read ${functionName}`);
    },
    simulateContract: async (request: Record<string, unknown>) => ({
      result: simulatedSplitId,
      request,
    }),
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      const stage = stageForTransaction(hash);
      const isFailure = stage === failureStage;
      return {
        status: isFailure && failure === "reverted" ? "reverted" : "success",
        transactionHash:
          isFailure && failure === "replaced" ? REPLACEMENT_TX : hash,
        logs:
          stage === "createSplit" &&
          !(isFailure && failure === "reverted")
            ? Array.from(
                { length: minedSplit.eventCount ?? 1 },
                () =>
                  splitCreatedLog(
                    minedSplit.splitId ?? simulatedSplitId,
                    minedSplit,
                  ),
              )
            : [],
      };
    },
  } as unknown as PublicClient;
  clients.walletClient = {
    writeContract: async ({
      functionName,
      args,
    }: {
      functionName: string;
      args?: readonly unknown[];
    }) => {
      if (functionName === "pay" && typeof args?.[0] === "bigint") {
        paidSplitIds.push(args[0]);
      }
      return transactionForFunction(functionName);
    },
  } as unknown as WalletClient;
}

beforeEach(() => {
  clients.publicClient = undefined;
  clients.walletClient = undefined;
});

describe("live Jellyfin FeeRouter receipts", () => {
  it("pays the split id emitted by the mined createSplit transaction", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "jellyfin-fee-router-"));
    const paidSplitIds: bigint[] = [];
    installClients({
      simulatedSplitId: 42n,
      minedSplit: { splitId: 43n },
      paidSplitIds,
    });
    const config = liveAdapterConfig(dir);

    try {
      const evidence = await createFeeRouterAdapter(config).settle({
        wallet: RECIPIENT,
        amountAtomicUsdc: 2500,
        itemId: "video-demo-001",
        eventId: `0x${"e".repeat(64)}`,
        watchedMinutes: 1,
      });

      expect(paidSplitIds).toEqual([43n]);
      expect(evidence.feeRouterSplitId).toBe("43");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  for (const [label, minedSplit, expectedError] of [
    [
      "contract address",
      { address: OTHER_ADDRESS },
      "no unique SplitCreated event",
    ],
    [
      "creator",
      { creator: OTHER_ADDRESS },
      "does not match the requested creator split",
    ],
    [
      "recipient",
      { recipients: [OTHER_ADDRESS] },
      "does not match the requested creator split",
    ],
    [
      "bps",
      { bps: [9_000] },
      "does not match the requested creator split",
    ],
    [
      "event uniqueness",
      { eventCount: 2 },
      "no unique SplitCreated event",
    ],
  ] satisfies [string, MinedSplit, string][]) {
    it(`rejects a SplitCreated receipt with invalid ${label}`, async () => {
      const dir = await mkdtemp(
        path.join(os.tmpdir(), "jellyfin-fee-router-"),
      );
      installClients({ minedSplit });
      const config = liveAdapterConfig(dir);

      try {
        await expect(
          createFeeRouterAdapter(config).settle({
            wallet: RECIPIENT,
            amountAtomicUsdc: 2500,
            itemId: "video-demo-001",
            eventId: `0x${"e".repeat(64)}`,
            watchedMinutes: 1,
          }),
        ).rejects.toThrow(expectedError);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  it.each([
    ["approval", "reverted"],
    ["approval", "replaced"],
    ["createSplit", "reverted"],
    ["createSplit", "replaced"],
    ["pay", "reverted"],
    ["pay", "replaced"],
  ] as const)(
    "rejects the %s transaction when its receipt is %s",
    async (failureStage, failure) => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "jellyfin-fee-router-"));
      installClients({ failureStage, failure });
      const config = liveAdapterConfig(dir);

      try {
        await expect(
          createFeeRouterAdapter(config).settle({
            wallet: RECIPIENT,
            amountAtomicUsdc: 2500,
            itemId: "video-demo-001",
            eventId: `0x${"e".repeat(64)}`,
            watchedMinutes: 1,
          }),
        ).rejects.toThrow(failure);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});
