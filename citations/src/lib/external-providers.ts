import type { Address, Hex, PublicClient } from "viem";
import { ARC_USDC, arcChain } from "./chain";
import {
  createFeeRouterPublicClient,
  createFeeRouterSigner,
  usdcRouterAbi,
  type FeeRouterWalletClient,
} from "./fee-router";
import { withReservedNonce } from "./fee-router-nonce";
import { sha256Hex } from "./hash";
import type { ExternalAssist } from "./types";

type FetchLike = typeof fetch;

export type ExternalProviderAskOptions = {
  privateKey?: Hex;
  publicClient?: PublicClient;
  walletClient?: FeeRouterWalletClient;
  fetch?: FetchLike;
};

export type ExternalProviderAnswer = {
  answer: string;
  assist: ExternalAssist;
};

// Thrown when the on-chain payment succeeded but the provider failed to
// answer. Carries the paid assist so callers can record the spend honestly
// instead of losing it.
export class EscalationPaidError extends Error {
  readonly assist: ExternalAssist;

  constructor(message: string, assist: ExternalAssist) {
    super(message);
    this.name = "EscalationPaidError";
    this.assist = assist;
  }
}

export type ExternalProvider = {
  id: string;
  label: string;
  endpoint: string;
  recipient: Address;
  priceAtomicUsdc: number;
  ask(
    question: string,
    options?: ExternalProviderAskOptions,
  ): Promise<ExternalProviderAnswer>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function textField(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : undefined;
}

async function askCitePay(
  question: string,
  options: ExternalProviderAskOptions = {},
): Promise<ExternalProviderAnswer> {
  const provider = EXTERNAL_PROVIDERS.citepay;
  const publicClient = options.publicClient ?? createFeeRouterPublicClient();
  const { account, walletClient } = createFeeRouterSigner({
    privateKey: options.privateKey,
    publicClient,
    walletClient: options.walletClient,
  });
  const transaction = await withReservedNonce(publicClient, account, (nonce) =>
    walletClient.writeContract({
      address: ARC_USDC,
      abi: usdcRouterAbi,
      functionName: "transfer",
      args: [provider.recipient, BigInt(provider.priceAtomicUsdc)],
      account,
      chain: arcChain,
      nonce,
    }),
  );
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transaction,
  });
  if (receipt.status !== "success") {
    throw new Error(`CitePay transfer failed with status ${receipt.status}.`);
  }

  // Money has moved from here on: any failure below must surface the paid
  // assist so the caller records the spend instead of losing it.
  const paidAssist: ExternalAssist = {
    provider: provider.id,
    endpoint: provider.endpoint,
    amountAtomicUsdc: provider.priceAtomicUsdc,
    transaction,
    answerHash: sha256Hex(""),
  };
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(provider.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Arc-Tx-Hash": transaction,
      },
      body: JSON.stringify({ query: question }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    throw new EscalationPaidError(
      `CitePay escalation paid but the request failed: ${message}`,
      paidAssist,
    );
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new EscalationPaidError(
      `CitePay escalation paid but got HTTP ${response.status}.`,
      paidAssist,
    );
  }
  if (!isRecord(payload)) {
    throw new EscalationPaidError(
      "CitePay escalation paid but returned an invalid response.",
      paidAssist,
    );
  }
  const answer = textField(payload.answer, 1_600);
  if (!answer) {
    throw new EscalationPaidError(
      "CitePay escalation paid but returned no answer.",
      paidAssist,
    );
  }

  const queryId = textField(payload.queryId, 120);
  const queryHash = textField(payload.queryHash, 120);
  return {
    answer,
    assist: {
      ...paidAssist,
      answerHash: sha256Hex(answer),
      ...(queryId ? { queryId } : {}),
      ...(queryHash ? { queryHash } : {}),
    },
  };
}

export const EXTERNAL_PROVIDERS = {
  citepay: {
    id: "citepay",
    label: "CitePay",
    endpoint: "https://citepay-markets.vercel.app/api/ask",
    recipient: "0x5389688243328c26a92b301faEEAb5fbf9AFf105",
    priceAtomicUsdc: 1_000,
    ask: askCitePay,
  },
} satisfies Record<string, ExternalProvider>;
