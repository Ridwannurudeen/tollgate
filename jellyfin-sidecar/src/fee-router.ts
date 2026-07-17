import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { SidecarConfig } from "./config.js";
import { sha256Hex } from "./hash.js";
import type {
  FeeRouterAdapter,
  FeeRouterSettlementInput,
  SettlementEvidence,
} from "./types.js";

const STANDING_FEE_ROUTER_ALLOWANCE = 10_000_000_000n;
let splitRegistryLock: Promise<void> = Promise.resolve();

const feeRouterAbi = [
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
] as const;

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
] as const;

type FeeRouterSplitView = {
  recipients: readonly Address[];
  bps: readonly number[];
};

type FeeRouterSplitRecord = {
  wallet: Address;
  splitId: string;
  recipients: Address[];
  bps: number[];
  createSplitTx: Hex;
  createdAt: string;
};

type FeeRouterSplitRegistry = {
  splits: FeeRouterSplitRecord[];
};

export class DryRunFeeRouterAdapter implements FeeRouterAdapter {
  async settle(input: FeeRouterSettlementInput): Promise<SettlementEvidence> {
    return {
      settlementMode: "dry-run",
      paymentResource: "forum-fee-router:dry-run",
      dryRun: true,
      wallet: input.wallet,
      amountAtomicUsdc: input.amountAtomicUsdc,
      feeRouterSplitId: sha256Hex({
        wallet: input.wallet,
        itemId: input.itemId,
      }).slice(0, 18),
    };
  }
}

function buildChain(config: SidecarConfig) {
  return defineChain({
    id: config.feeRouterChainId,
    name: "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [config.feeRouterRpcUrl] } },
    blockExplorers: {
      default: { name: "Arcscan", url: "https://testnet.arcscan.app" },
    },
    testnet: true,
  });
}

function assertValidFeeRouterSplit(recipients: Address[], bps: number[]): void {
  if (recipients.length === 0) {
    throw new Error("FeeRouter split needs at least one recipient.");
  }
  if (recipients.length !== bps.length) {
    throw new Error("FeeRouter recipients and bps length mismatch.");
  }
  const totalBps = bps.reduce((sum, value) => sum + value, 0);
  if (totalBps !== 10_000) {
    throw new Error(`FeeRouter bps must sum to 10000; got ${totalBps}.`);
  }
}

function isAddressString(value: unknown): value is Address {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

function isHexString(value: unknown): value is Hex {
  return typeof value === "string" && /^0x[a-fA-F0-9]+$/.test(value);
}

function isFeeRouterSplitRegistry(
  value: unknown,
): value is FeeRouterSplitRegistry {
  if (!value || typeof value !== "object") return false;
  const splits = (value as Record<string, unknown>).splits;
  return (
    Array.isArray(splits) &&
    splits.every((split) => {
      if (!split || typeof split !== "object") return false;
      const record = split as Record<string, unknown>;
      return (
        isAddressString(record.wallet) &&
        typeof record.splitId === "string" &&
        Array.isArray(record.recipients) &&
        record.recipients.every(isAddressString) &&
        Array.isArray(record.bps) &&
        record.bps.every((bps) => typeof bps === "number") &&
        isHexString(record.createSplitTx) &&
        typeof record.createdAt === "string"
      );
    })
  );
}

async function readFeeRouterSplitRegistry(
  filePath: string,
): Promise<FeeRouterSplitRegistry> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return isFeeRouterSplitRegistry(parsed) ? parsed : { splits: [] };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { splits: [] };
    throw error;
  }
}

async function writeFeeRouterSplitRegistry(
  registry: FeeRouterSplitRegistry,
  filePath: string,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}`;
  await writeFile(tmpPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmpPath, filePath);
}

function withSplitRegistryLock<T>(write: () => Promise<T>): Promise<T> {
  const run = splitRegistryLock.then(write, write);
  splitRegistryLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function waitForSuccessfulTransaction(
  publicClient: PublicClient,
  transaction: Hex,
  operation: string,
) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transaction,
  });
  if (receipt.transactionHash.toLowerCase() !== transaction.toLowerCase()) {
    throw new Error(`${operation} was replaced.`);
  }
  if (receipt.status !== "success") {
    throw new Error(`${operation} failed with status ${receipt.status}.`);
  }
  return receipt;
}

async function readFeeRouterSplit(
  splitId: bigint,
  feeRouterAddress: Address,
  publicClient: PublicClient,
): Promise<FeeRouterSplitView> {
  const split = await publicClient.readContract({
    address: feeRouterAddress,
    abi: feeRouterAbi,
    functionName: "splitAt",
    args: [splitId],
  });

  return {
    recipients: split.recipients,
    bps: split.bps.map((value) => Number(value)),
  };
}

function sameAddressList(
  a: readonly Address[],
  b: readonly Address[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (address, index) => address.toLowerCase() === b[index]?.toLowerCase(),
    )
  );
}

function sameBpsList(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function verifyCreatorSplit(
  record: FeeRouterSplitRecord,
  recipients: Address[],
  bps: number[],
  feeRouterAddress: Address,
  publicClient: PublicClient,
): Promise<void> {
  const split = await readFeeRouterSplit(
    BigInt(record.splitId),
    feeRouterAddress,
    publicClient,
  );
  if (
    !sameAddressList(split.recipients, recipients) ||
    !sameBpsList(split.bps, bps)
  ) {
    throw new Error(
      `FeeRouter split ${record.splitId} does not match creator recipients.`,
    );
  }
}

async function ensureCreatorSplit(
  recipient: Address,
  config: SidecarConfig,
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: ReturnType<typeof privateKeyToAccount>,
): Promise<FeeRouterSplitRecord> {
  const recipients = [recipient];
  const bps = [10_000];
  assertValidFeeRouterSplit(recipients, bps);

  return withSplitRegistryLock(async () => {
    const registry = await readFeeRouterSplitRegistry(
      config.feeRouterSplitRegistryPath,
    );
    const existing = registry.splits.find(
      (split) =>
        split.wallet.toLowerCase() === recipient.toLowerCase() &&
        sameAddressList(split.recipients, recipients) &&
        sameBpsList(split.bps, bps),
    );
    if (existing) {
      await verifyCreatorSplit(
        existing,
        recipients,
        bps,
        config.feeRouterAddress,
        publicClient,
      );
      return existing;
    }

    const chain = buildChain(config);
    const { request } = await publicClient.simulateContract({
      address: config.feeRouterAddress,
      abi: feeRouterAbi,
      functionName: "createSplit",
      args: [recipients, bps],
      account: account.address,
      chain,
    });
    const createSplitTx = await walletClient.writeContract({
      ...request,
      account,
    });
    const receipt = await waitForSuccessfulTransaction(
      publicClient,
      createSplitTx,
      "FeeRouter createSplit transaction",
    );
    const events = parseEventLogs({
      abi: feeRouterAbi,
      eventName: "SplitCreated",
      logs: receipt.logs.filter(
        (log) =>
          log.address.toLowerCase() ===
          config.feeRouterAddress.toLowerCase(),
      ),
    });
    const [createdEvent] = events;
    if (events.length !== 1 || !createdEvent) {
      throw new Error(
        "FeeRouter createSplit receipt has no unique SplitCreated event.",
      );
    }
    const created = createdEvent.args;
    if (
      created.creator.toLowerCase() !== account.address.toLowerCase() ||
      !sameAddressList(created.recipients, recipients) ||
      !sameBpsList(
        created.bps.map((value) => Number(value)),
        bps,
      )
    ) {
      throw new Error(
        "FeeRouter SplitCreated event does not match the requested creator split.",
      );
    }

    const record: FeeRouterSplitRecord = {
      wallet: recipient,
      splitId: created.splitId.toString(),
      recipients,
      bps,
      createSplitTx,
      createdAt: new Date().toISOString(),
    };
    await writeFeeRouterSplitRegistry(
      { splits: [...registry.splits, record] },
      config.feeRouterSplitRegistryPath,
    );
    return record;
  });
}

class LiveFeeRouterAdapter implements FeeRouterAdapter {
  private settlementLock: Promise<void> = Promise.resolve();

  constructor(private readonly config: SidecarConfig) {}

  async settle(input: FeeRouterSettlementInput): Promise<SettlementEvidence> {
    const run = this.settlementLock.then(
      () => this.settleNow(input),
      () => this.settleNow(input),
    );
    this.settlementLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async settleNow(
    input: FeeRouterSettlementInput,
  ): Promise<SettlementEvidence> {
    if (input.amountAtomicUsdc <= 0) {
      throw new Error("Settlement amount must be greater than zero.");
    }
    if (!this.config.feeRouterPrivateKey) {
      throw new Error("FeeRouter private key is required in live mode.");
    }

    const amount = BigInt(input.amountAtomicUsdc);
    const chain = buildChain(this.config);
    const account = privateKeyToAccount(this.config.feeRouterPrivateKey);
    const publicClient = createPublicClient({
      chain,
      transport: http(this.config.feeRouterRpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(this.config.feeRouterRpcUrl),
    });

    const [balance, allowance] = await Promise.all([
      publicClient.readContract({
        address: this.config.feeRouterUsdcAddress,
        abi: usdcAbi,
        functionName: "balanceOf",
        args: [account.address],
      }),
      publicClient.readContract({
        address: this.config.feeRouterUsdcAddress,
        abi: usdcAbi,
        functionName: "allowance",
        args: [account.address, this.config.feeRouterAddress],
      }),
    ]);

    if (balance < amount) {
      throw new Error("FeeRouter payer has insufficient USDC asset balance.");
    }

    if (allowance < amount) {
      const approveTx = await walletClient.writeContract({
        address: this.config.feeRouterUsdcAddress,
        abi: usdcAbi,
        functionName: "approve",
        args: [this.config.feeRouterAddress, STANDING_FEE_ROUTER_ALLOWANCE],
        account,
        chain,
      });
      await waitForSuccessfulTransaction(
        publicClient,
        approveTx,
        "FeeRouter approval transaction",
      );
    }

    const split = await ensureCreatorSplit(
      input.wallet,
      this.config,
      publicClient,
      walletClient,
      account,
    );

    const payTx = await walletClient.writeContract({
      address: this.config.feeRouterAddress,
      abi: feeRouterAbi,
      functionName: "pay",
      args: [BigInt(split.splitId), amount],
      account,
      chain,
    });
    await waitForSuccessfulTransaction(
      publicClient,
      payTx,
      "FeeRouter pay transaction",
    );

    return {
      settlementMode: "forum-routed",
      paymentResource: `forum-fee-router:${this.config.feeRouterAddress}`,
      wallet: input.wallet,
      amountAtomicUsdc: input.amountAtomicUsdc,
      payer: account.address,
      transaction: payTx,
      feeRouterSplitId: split.splitId,
      feeRouterCreateSplitTx: split.createSplitTx,
      feeRouterPayTx: payTx,
    };
  }
}

export function createFeeRouterAdapter(config: SidecarConfig): FeeRouterAdapter {
  if (config.feeRouterMode === "live") {
    return new LiveFeeRouterAdapter(config);
  }
  return new DryRunFeeRouterAdapter();
}
