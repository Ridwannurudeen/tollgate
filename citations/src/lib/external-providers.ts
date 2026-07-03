import type { Address, Hex, PublicClient } from "viem";
import { ARC_USDC, arcTestnet } from "./chain";
import {
  createFeeRouterPublicClient,
  createFeeRouterSigner,
  usdcRouterAbi,
  type FeeRouterWalletClient,
} from "./fee-router";
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
  const transaction = await walletClient.writeContract({
    address: ARC_USDC,
    abi: usdcRouterAbi,
    functionName: "transfer",
    args: [provider.recipient, BigInt(provider.priceAtomicUsdc)],
    account,
    chain: arcTestnet,
  });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: transaction,
  });
  if (receipt.status !== "success") {
    throw new Error(`CitePay transfer failed with status ${receipt.status}.`);
  }

  const response = await (options.fetch ?? fetch)(provider.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Arc-Tx-Hash": transaction,
    },
    body: JSON.stringify({ query: question }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(`CitePay escalation failed with HTTP ${response.status}.`);
  }
  if (!isRecord(payload)) {
    throw new Error("CitePay escalation returned an invalid response.");
  }
  const answer = textField(payload.answer, 1_600);
  if (!answer) {
    throw new Error("CitePay escalation returned no answer.");
  }

  const queryId = textField(payload.queryId, 120);
  const queryHash = textField(payload.queryHash, 120);
  return {
    answer,
    assist: {
      provider: provider.id,
      endpoint: provider.endpoint,
      amountAtomicUsdc: provider.priceAtomicUsdc,
      transaction,
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
