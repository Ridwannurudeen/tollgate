import {
  getAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { ARC_USDC, arcChain } from "./chain";
import {
  createFeeRouterPublicClient,
  feeRouterSettlementEnabled,
  planCitationPayments,
  prepareCitationSplit,
  usdcRouterAbi,
  waitForSuccessfulTransaction,
  withFeeRouterSigner,
  type FeeRouterRouteOptions,
} from "./fee-router";
import { feeRouterAllowanceTarget } from "./fee-router-allowance";
import { FEE_ROUTER_ADDRESS } from "./fee-router-contract";
import { withReservedNonce } from "./fee-router-nonce";
import type { QueryRecord, ReceiptEvidence } from "./types";
import {
  useIntentContractValue,
  useIntentTypes,
  type BuiltUseIntent,
  type TollgateUseIntent,
} from "./use-intent";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export const payGateAbi = [
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
      {
        name: "intent",
        type: "tuple",
        components: useIntentTypes.TollgateUseIntent,
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
    type: "event",
    name: "PaidWithIntent",
    inputs: [
      { name: "queryHash", type: "bytes32", indexed: true },
      { name: "digest", type: "bytes32", indexed: true },
      { name: "payer", type: "address", indexed: true },
      { name: "total", type: "uint256", indexed: false },
    ],
  },
] as const;

export type PayGatePayment = {
  splitId: bigint;
  amount: bigint;
};

export type PayGateOptions = FeeRouterRouteOptions & {
  address?: Address;
};

export type PayGateSettlement = {
  evidenceBySourceId: Record<string, ReceiptEvidence>;
  transaction: Hex | null;
  digest: Hex | null;
  payGateAddress: Address | null;
};

export function payGateAddress(): Address | null {
  const configured = process.env.LEPTONWEB_PAYGATE_ADDRESS?.trim();
  if (!configured) return null;
  if (!ADDRESS_PATTERN.test(configured)) {
    throw new Error("LEPTONWEB_PAYGATE_ADDRESS must be a 20-byte EVM address.");
  }
  return getAddress(configured);
}

export function assertPayGatePaymentsWithinIntent(
  payments: readonly { amount: bigint }[],
  intent: TollgateUseIntent,
): bigint {
  if (payments.length === 0) {
    throw new Error("PayGate requires at least one payment.");
  }
  let total = 0n;
  for (const payment of payments) {
    if (payment.amount <= 0n) {
      throw new Error("PayGate payment amounts must be positive.");
    }
    total += payment.amount;
  }
  if (total > intent.maxSpendAtomicUsdc) {
    throw new Error(
      `PayGate spend ${total.toString()} exceeds max ${intent.maxSpendAtomicUsdc.toString()} atomic USDC.`,
    );
  }
  return total;
}

async function assertPayGateConfiguration(
  publicClient: PublicClient,
  address: Address,
  built: BuiltUseIntent,
  payer: Address,
): Promise<void> {
  const [registry, feeRouter, usdc, configuredPayer] = await Promise.all([
    publicClient.readContract({
      address,
      abi: payGateAbi,
      functionName: "registry",
    }),
    publicClient.readContract({
      address,
      abi: payGateAbi,
      functionName: "feeRouter",
    }),
    publicClient.readContract({
      address,
      abi: payGateAbi,
      functionName: "usdc",
    }),
    publicClient.readContract({
      address,
      abi: payGateAbi,
      functionName: "payer",
    }),
  ]);
  if (registry.toLowerCase() !== built.registryAddress.toLowerCase()) {
    throw new Error("PayGate registry does not match the signed intent.");
  }
  if (feeRouter.toLowerCase() !== FEE_ROUTER_ADDRESS.toLowerCase()) {
    throw new Error("PayGate FeeRouter does not match Tollgate configuration.");
  }
  if (usdc.toLowerCase() !== ARC_USDC.toLowerCase()) {
    throw new Error("PayGate USDC does not match Arc configuration.");
  }
  if (configuredPayer.toLowerCase() !== payer.toLowerCase()) {
    throw new Error(
      "PayGate authorized payer does not match the settlement signer.",
    );
  }
}

export async function payCitationsWithIntent(
  query: QueryRecord,
  built: BuiltUseIntent,
  signature: Hex,
  options: PayGateOptions = {},
): Promise<PayGateSettlement> {
  const address = options.address ?? payGateAddress();
  if (!address) throw new Error("PayGate settlement is not configured.");
  const plan = planCitationPayments(query);
  if (plan.payments.length === 0) {
    return {
      evidenceBySourceId: plan.evidenceBySourceId,
      transaction: null,
      digest: null,
      payGateAddress: null,
    };
  }
  if (!feeRouterSettlementEnabled(options)) {
    throw new Error("PayGate settlement requires FeeRouter settlement.");
  }
  const plannedPayments = plan.payments.map((payment) => ({
    amount: BigInt(payment.amountAtomicUsdc),
  }));
  const total = assertPayGatePaymentsWithinIntent(
    plannedPayments,
    built.intent,
  );
  const allowanceTarget = feeRouterAllowanceTarget(total);
  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  return withFeeRouterSigner(options, async ({ account, walletClient }) => {
    await assertPayGateConfiguration(
      publicClient,
      address,
      built,
      account.address,
    );
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "balanceOf",
        args: [account.address],
      }),
      publicClient.readContract({
        address: ARC_USDC,
        abi: usdcRouterAbi,
        functionName: "allowance",
        args: [account.address, address],
      }),
    ]);
    if (balance < total) {
      throw new Error("PayGate payer has insufficient USDC asset balance.");
    }
    if (allowance !== allowanceTarget) {
      const approval = await withReservedNonce(publicClient, account, (nonce) =>
        walletClient.writeContract({
          address: ARC_USDC,
          abi: usdcRouterAbi,
          functionName: "approve",
          args: [address, allowanceTarget],
          account,
          chain: arcChain,
          nonce,
        }),
      );
      await waitForSuccessfulTransaction(
        publicClient,
        approval,
        "PayGate approval transaction",
      );
    }

    const preparedPayments = await Promise.all(
      plan.payments.map(async (payment) => ({
        payment,
        split: await prepareCitationSplit(
          payment,
          publicClient,
          walletClient,
          account,
          options,
        ),
      })),
    );
    const contractPayments: PayGatePayment[] = preparedPayments.map(
      ({ payment, split }) => ({
        splitId: BigInt(split.splitId),
        amount: BigInt(payment.amountAtomicUsdc),
      }),
    );
    const transaction = await withReservedNonce(
      publicClient,
      account,
      (nonce) =>
        walletClient.writeContract({
          address,
          abi: payGateAbi,
          functionName: "payWithIntent",
          args: [
            useIntentContractValue(built.intent),
            signature,
            contractPayments,
          ],
          account,
          chain: arcChain,
          nonce,
        }),
    );
    const receipt = await waitForSuccessfulTransaction(
      publicClient,
      transaction,
      "PayGate settlement transaction",
    );
    const paidEvents = parseEventLogs({
      abi: payGateAbi,
      eventName: "PaidWithIntent",
      logs: receipt.logs,
    }).filter((event) => event.address.toLowerCase() === address.toLowerCase());
    if (paidEvents.length !== 1) {
      throw new Error(
        "PayGate settlement receipt has no unique payment event.",
      );
    }
    const paid = paidEvents[0].args;
    if (
      paid.queryHash.toLowerCase() !== built.intent.queryHash.toLowerCase() ||
      paid.digest.toLowerCase() !== built.digest.toLowerCase() ||
      paid.payer.toLowerCase() !== account.address.toLowerCase() ||
      paid.total !== total
    ) {
      throw new Error(
        "PayGate settlement event does not match the signed payment.",
      );
    }

    const evidenceBySourceId = { ...plan.evidenceBySourceId };
    for (const { payment, split } of preparedPayments) {
      evidenceBySourceId[payment.sourceId] = {
        settlementMode: "forum-routed",
        payer: account.address,
        transaction,
        paymentResource: `tollgate-pay-gate:${address}`,
        feeRouterSplitId: split.splitId,
        feeRouterCreateSplitTx: split.createSplitTx,
        feeRouterPayTx: transaction,
      };
    }
    return {
      evidenceBySourceId,
      transaction,
      digest: built.digest,
      payGateAddress: address,
    };
  });
}
