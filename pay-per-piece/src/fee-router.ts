import {
  createPublicClient,
  createWalletClient,
  http,
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_RPC_URL, ARC_USDC, arcTestnet } from "./chain.js";
import { FEE_ROUTER_ADDRESS, feeRouterV1Abi } from "./fee-router-contract.js";
import { withReservedNonce } from "./fee-router-nonce.js";

const ARC_POLLING_INTERVAL_MS = 250;
const STANDING_FEE_ROUTER_ALLOWANCE = 10_000_000_000n;
const MAX_UINT256 = (1n << 256n) - 1n;
const payerPaymentLocks = new Map<string, Promise<void>>();

export const usdcRouterAbi = [
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

export const feeRouterEventsAbi = [
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
    type: "event",
    name: "Routed",
    inputs: [
      { name: "splitId", type: "uint256", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

export type FeeRouterReadiness = {
  splitCount: bigint;
  payerAssetBalance: bigint;
  payerAllowance: bigint;
  recipientClaimable: bigint;
};

export type FeeRouterSplitView = {
  creator: Address;
  recipients: readonly Address[];
  bps: readonly number[];
  totalRouted: bigint;
  createdAt: bigint;
};

export type FeeRouterWriteContractRequest = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  account?: unknown;
  chain?: typeof arcTestnet;
  nonce?: number;
};

export type FeeRouterWalletClient = {
  writeContract(request: FeeRouterWriteContractRequest): Promise<Hex>;
};

export type FeeRouterSigner = {
  account: { address: Address };
  walletClient: FeeRouterWalletClient;
};

export type FeeRouterSignerOptions = {
  rpcUrl?: string;
  walletClient?: FeeRouterWalletClient;
};

export function createFeeRouterPublicClient(
  rpcUrl: string = ARC_RPC_URL,
): PublicClient {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(rpcUrl),
    pollingInterval: ARC_POLLING_INTERVAL_MS,
  });
}

function viemFeeRouterWalletClient(
  walletClient: WalletClient,
): FeeRouterWalletClient {
  type ViemWriteContractRequest = Parameters<WalletClient["writeContract"]>[0];
  return {
    writeContract: (request) =>
      walletClient.writeContract(request as ViemWriteContractRequest),
  };
}

export function createFeeRouterSigner(
  privateKey: Hex,
  options: FeeRouterSignerOptions = {},
): FeeRouterSigner {
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    walletClient:
      options.walletClient ??
      viemFeeRouterWalletClient(
        createWalletClient({
          account,
          chain: arcTestnet,
          transport: http(options.rpcUrl ?? ARC_RPC_URL),
          pollingInterval: ARC_POLLING_INTERVAL_MS,
        }),
      ),
  };
}

export function assertValidFeeRouterSplit(
  recipients: Address[],
  bps: number[],
): void {
  if (recipients.length === 0) {
    throw new Error("FeeRouter split needs at least one recipient.");
  }
  if (recipients.length !== bps.length) {
    throw new Error("FeeRouter recipients and bps length mismatch.");
  }
  if (
    recipients.some(
      (recipient) =>
        !/^0x[a-fA-F0-9]{40}$/.test(recipient) || /^0x0{40}$/i.test(recipient),
    )
  ) {
    throw new Error("FeeRouter recipients must be non-zero EVM addresses.");
  }
  if (
    bps.some((value) => !Number.isInteger(value) || value < 0 || value > 65_535)
  ) {
    throw new Error("FeeRouter bps must be uint16 integers.");
  }
  const totalBps = bps.reduce((sum, value) => sum + value, 0);
  if (totalBps !== 10_000) {
    throw new Error(`FeeRouter bps must sum to 10000; got ${totalBps}.`);
  }
}

export async function readFeeRouterReadiness(
  payer: Address,
  recipient: Address,
  publicClient: PublicClient = createFeeRouterPublicClient(),
): Promise<FeeRouterReadiness> {
  const [splitCount, payerAssetBalance, payerAllowance, recipientClaimable] =
    await Promise.all([
      publicClient.readContract({
        address: FEE_ROUTER_ADDRESS,
        abi: feeRouterV1Abi,
        functionName: "splitCount",
      }),
      publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "balanceOf",
        args: [payer],
      }),
      publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "allowance",
        args: [payer, FEE_ROUTER_ADDRESS],
      }),
      publicClient.readContract({
        address: FEE_ROUTER_ADDRESS,
        abi: feeRouterV1Abi,
        functionName: "totalClaimableOf",
        args: [recipient],
      }),
    ]);

  return {
    splitCount,
    payerAssetBalance,
    payerAllowance,
    recipientClaimable,
  };
}

export async function readFeeRouterClaimable(
  recipient: Address,
  publicClient: PublicClient = createFeeRouterPublicClient(),
): Promise<bigint> {
  return publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "totalClaimableOf",
    args: [recipient],
  });
}

export async function readFeeRouterSplit(
  splitId: bigint,
  publicClient: PublicClient = createFeeRouterPublicClient(),
): Promise<FeeRouterSplitView> {
  if (splitId < 0n || splitId > MAX_UINT256) {
    throw new Error("FeeRouter splitId must be a uint256.");
  }
  const split = await publicClient.readContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "splitAt",
    args: [splitId],
  });

  return {
    creator: split.creator,
    recipients: split.recipients,
    bps: split.bps.map((value) => Number(value)),
    totalRouted: split.totalRouted,
    createdAt: split.createdAt,
  };
}

async function waitForSuccessfulTransaction(
  publicClient: PublicClient,
  hash: Hex,
) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`FeeRouter transaction ${hash} reverted.`);
  }
  return receipt;
}

function sameAddressList(
  left: readonly Address[],
  right: readonly Address[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (address, index) => address.toLowerCase() === right[index]?.toLowerCase(),
    )
  );
}

function sameBpsList(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function withPayerPaymentLock<T>(
  address: Address,
  task: () => Promise<T>,
): Promise<T> {
  const key = address.toLowerCase();
  const previous = payerPaymentLocks.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  payerPaymentLocks.set(key, tail);
  return run.finally(() => {
    if (payerPaymentLocks.get(key) === tail) payerPaymentLocks.delete(key);
  });
}

export async function createSplit(
  signer: FeeRouterSigner,
  recipients: Address[],
  bps: number[],
  publicClient: PublicClient = createFeeRouterPublicClient(),
): Promise<{ splitId: bigint; txHash: Hex }> {
  assertValidFeeRouterSplit(recipients, bps);
  const { request } = await publicClient.simulateContract({
    address: FEE_ROUTER_ADDRESS,
    abi: feeRouterV1Abi,
    functionName: "createSplit",
    args: [recipients, bps],
    account: signer.account.address,
    chain: arcTestnet,
  });
  const txHash = await withReservedNonce(
    publicClient,
    signer.account,
    (nonce) =>
      signer.walletClient.writeContract({
        ...request,
        account: signer.account,
        nonce,
      }),
  );
  const receipt = await waitForSuccessfulTransaction(publicClient, txHash);
  const [event] = parseEventLogs({
    abi: feeRouterEventsAbi,
    eventName: "SplitCreated",
    logs: receipt.logs.filter(
      (log) => log.address.toLowerCase() === FEE_ROUTER_ADDRESS.toLowerCase(),
    ),
  });
  if (!event) {
    throw new Error(
      `FeeRouter transaction ${txHash} emitted no SplitCreated event.`,
    );
  }
  if (
    event.args.creator.toLowerCase() !== signer.account.address.toLowerCase()
  ) {
    throw new Error(
      `FeeRouter transaction ${txHash} recorded the wrong creator.`,
    );
  }
  if (
    !sameAddressList(event.args.recipients, recipients) ||
    !sameBpsList(event.args.bps.map(Number), bps)
  ) {
    throw new Error(
      `FeeRouter transaction ${txHash} recorded the wrong split.`,
    );
  }

  return { splitId: event.args.splitId, txHash };
}

export function payViaSplit(
  signer: FeeRouterSigner,
  splitId: bigint,
  amountAtomicUsdc: bigint,
  publicClient: PublicClient = createFeeRouterPublicClient(),
): Promise<{ txHash: Hex }> {
  return withPayerPaymentLock(signer.account.address, async () => {
    if (splitId < 0n || splitId > MAX_UINT256) {
      throw new Error("FeeRouter splitId must be a uint256.");
    }
    if (amountAtomicUsdc <= 0n) {
      throw new Error("FeeRouter payment amount must be positive.");
    }
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "balanceOf",
        args: [signer.account.address],
      }),
      publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "allowance",
        args: [signer.account.address, FEE_ROUTER_ADDRESS],
      }),
    ]);

    if (balance < amountAtomicUsdc) {
      throw new Error("FeeRouter payer has insufficient USDC asset balance.");
    }

    if (allowance < amountAtomicUsdc) {
      const approvalAmount =
        amountAtomicUsdc > STANDING_FEE_ROUTER_ALLOWANCE
          ? amountAtomicUsdc
          : STANDING_FEE_ROUTER_ALLOWANCE;
      const approvalTx = await withReservedNonce(
        publicClient,
        signer.account,
        (nonce) =>
          signer.walletClient.writeContract({
            address: ARC_USDC,
            abi: usdcRouterAbi,
            functionName: "approve",
            args: [FEE_ROUTER_ADDRESS, approvalAmount],
            account: signer.account,
            chain: arcTestnet,
            nonce,
          }),
      );
      await waitForSuccessfulTransaction(publicClient, approvalTx);
    }

    const txHash = await withReservedNonce(
      publicClient,
      signer.account,
      (nonce) =>
        signer.walletClient.writeContract({
          address: FEE_ROUTER_ADDRESS,
          abi: feeRouterV1Abi,
          functionName: "pay",
          args: [splitId, amountAtomicUsdc],
          account: signer.account,
          chain: arcTestnet,
          nonce,
        }),
    );
    const receipt = await waitForSuccessfulTransaction(publicClient, txHash);
    const [event] = parseEventLogs({
      abi: feeRouterEventsAbi,
      eventName: "Routed",
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === FEE_ROUTER_ADDRESS.toLowerCase(),
      ),
    });
    if (
      !event ||
      event.args.splitId !== splitId ||
      event.args.payer.toLowerCase() !== signer.account.address.toLowerCase() ||
      event.args.amount !== amountAtomicUsdc
    ) {
      throw new Error(
        `FeeRouter transaction ${txHash} emitted no matching Routed event.`,
      );
    }

    return { txHash };
  });
}
