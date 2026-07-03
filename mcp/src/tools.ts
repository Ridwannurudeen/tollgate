import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import type { SignTypedDataParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARC_CAIP2 = "eip155:5042002";
const DEFAULT_BASE_URL = "https://tollgate.gudman.xyz";
const READER_PRIVATE_KEY_ENV = "TOLLGATE_READER_PRIVATE_KEY";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type TollgateSettlementMode =
  | "local-proof"
  | "x402-verified"
  | "x402-settled"
  | "forum-routed"
  | "escrowed"
  | "refunded";

export type TollgateQueryPayment = {
  amountAtomicUsdc: number;
  settlementMode: TollgateSettlementMode;
  payTo: `0x${string}`;
  payer?: string;
  transaction?: string;
  paymentResource: string;
  paymentHash: string;
};

export type TollgateQuery = {
  id: string;
  question: string;
  answer: string;
  queryHash: string;
  answerHash: string;
  totalAtomicUsdc: number;
  citations: Record<string, unknown>[];
  receiptHashes: string[];
  readerPayment?: TollgateQueryPayment;
  createdAt: string;
};

export type TollgateReceipt = {
  id: string;
  queryId: string;
  sourceId: string;
  creator: string;
  wallet: `0x${string}`;
  amountAtomicUsdc: number;
  settlementMode: TollgateSettlementMode;
  queryPaymentHash?: string;
  payer?: string;
  transaction?: string;
  paymentResource?: string;
  previousHash: string;
  receiptHash: string;
  createdAt: string;
};

export type TollgateAskResult = {
  answer: string;
  query: TollgateQuery;
  receipts: TollgateReceipt[];
  proofUrls: {
    proof: string;
    answer: string;
    answerByHash: string;
    receipts: string[];
  };
};

export type TollgateSourceSummary = {
  id: string;
  title: string;
  creator: string;
  wallet: string;
  priceAtomicUsdc: number;
  verifiedCreator: boolean;
  probation?: boolean;
  url: string;
};

type SourceApiResponse = {
  sources?: unknown;
};

type ToolOptions = {
  baseUrl?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
  paidFetch?: FetchLike;
};

function baseUrl(options: Pick<ToolOptions, "baseUrl" | "env"> = {}): string {
  const env = options.env ?? process.env;
  return options.baseUrl ?? env.TOLLGATE_BASE_URL ?? DEFAULT_BASE_URL;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isHex(value: unknown): value is `0x${string}` {
  return typeof value === "string" && value.startsWith("0x");
}

function isSettlementMode(value: unknown): value is TollgateSettlementMode {
  return (
    value === "local-proof" ||
    value === "x402-verified" ||
    value === "x402-settled" ||
    value === "forum-routed" ||
    value === "escrowed" ||
    value === "refunded"
  );
}

function isQueryPayment(value: unknown): value is TollgateQueryPayment {
  if (!isRecord(value)) return false;
  return (
    typeof value.amountAtomicUsdc === "number" &&
    isSettlementMode(value.settlementMode) &&
    isHex(value.payTo) &&
    (value.payer === undefined || typeof value.payer === "string") &&
    (value.transaction === undefined ||
      typeof value.transaction === "string") &&
    typeof value.paymentResource === "string" &&
    typeof value.paymentHash === "string"
  );
}

function isTollgateQuery(value: unknown): value is TollgateQuery {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.question === "string" &&
    typeof value.answer === "string" &&
    typeof value.queryHash === "string" &&
    typeof value.answerHash === "string" &&
    typeof value.totalAtomicUsdc === "number" &&
    Array.isArray(value.citations) &&
    value.citations.every(isRecord) &&
    Array.isArray(value.receiptHashes) &&
    value.receiptHashes.every(isString) &&
    (value.readerPayment === undefined || isQueryPayment(value.readerPayment)) &&
    typeof value.createdAt === "string"
  );
}

function isTollgateReceipt(value: unknown): value is TollgateReceipt {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.queryId === "string" &&
    typeof value.sourceId === "string" &&
    typeof value.creator === "string" &&
    isHex(value.wallet) &&
    typeof value.amountAtomicUsdc === "number" &&
    isSettlementMode(value.settlementMode) &&
    (value.queryPaymentHash === undefined ||
      typeof value.queryPaymentHash === "string") &&
    (value.payer === undefined || typeof value.payer === "string") &&
    (value.transaction === undefined ||
      typeof value.transaction === "string") &&
    (value.paymentResource === undefined ||
      typeof value.paymentResource === "string") &&
    typeof value.previousHash === "string" &&
    typeof value.receiptHash === "string" &&
    typeof value.createdAt === "string"
  );
}

function parseAskResult(body: unknown, url: URL): TollgateAskResult {
  if (!isRecord(body)) {
    throw new Error("Tollgate response must be a JSON object.");
  }
  if (!isTollgateQuery(body.query)) {
    throw new Error("Tollgate response is missing a valid query.");
  }
  if (
    !Array.isArray(body.receipts) ||
    !body.receipts.every(isTollgateReceipt)
  ) {
    throw new Error("Tollgate response is missing valid receipts.");
  }

  const receiptHashes =
    body.query.receiptHashes.length > 0
      ? body.query.receiptHashes
      : body.receipts.map((receipt) => receipt.receiptHash);

  return {
    answer: body.query.answer,
    query: body.query,
    receipts: body.receipts,
    proofUrls: {
      proof: new URL("/proof", url).toString(),
      answer: new URL(`/answers/${body.query.id}`, url).toString(),
      answerByHash: new URL(`/answers/${body.query.answerHash}`, url).toString(),
      receipts: receiptHashes.map((receiptHash) =>
        new URL(`/receipts/${receiptHash}`, url).toString(),
      ),
    },
  };
}

function errorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.error === "string" ? body.error : null;
}

function normalizePrivateKey(value: string): `0x${string}` {
  const privateKey = value.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error(
      `${READER_PRIVATE_KEY_ENV} must be a 32-byte 0x-prefixed private key.`,
    );
  }
  return privateKey as `0x${string}`;
}

export function createPaidFetch(privateKey: string): FetchLike {
  const account = privateKeyToAccount(normalizePrivateKey(privateKey));
  const signer = {
    address: account.address,
    signTypedData: (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => account.signTypedData(message as SignTypedDataParameters),
  };

  return wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: ARC_CAIP2, client: new ExactEvmScheme(signer) }],
  });
}

function queryFetch(options: ToolOptions): { fetcher: FetchLike; paid: boolean } {
  if (options.paidFetch) {
    return { fetcher: options.paidFetch, paid: true };
  }

  const env = options.env ?? process.env;
  const privateKey = env[READER_PRIVATE_KEY_ENV];
  if (privateKey) {
    return { fetcher: createPaidFetch(privateKey), paid: true };
  }

  if (env.TOLLGATE_ALLOW_FREE_QUERY === "1") {
    return { fetcher: options.fetch ?? globalThis.fetch, paid: false };
  }

  throw new Error(
    `Set ${READER_PRIVATE_KEY_ENV} to run tollgate_ask against the paid endpoint.`,
  );
}

function sourceSummary(value: unknown): TollgateSourceSummary | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.creator !== "string" ||
    typeof value.wallet !== "string" ||
    typeof value.priceAtomicUsdc !== "number" ||
    typeof value.verifiedCreator !== "boolean" ||
    typeof value.url !== "string"
  ) {
    return null;
  }
  return {
    id: value.id,
    title: value.title,
    creator: value.creator,
    wallet: value.wallet,
    priceAtomicUsdc: value.priceAtomicUsdc,
    verifiedCreator: value.verifiedCreator,
    ...(typeof value.probation === "boolean"
      ? { probation: value.probation }
      : {}),
    url: value.url,
  };
}

export async function tollgateAsk(
  question: string,
  options: ToolOptions = {},
): Promise<TollgateAskResult> {
  const url = new URL(baseUrl(options));
  const { fetcher, paid } = queryFetch(options);
  const response = await fetcher(new URL(paid ? "/api/paid-query" : "/api/query", url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new Error(
      errorMessage(body) ?? `Tollgate request failed with HTTP ${response.status}.`,
    );
  }

  return parseAskResult(body, url);
}

export async function tollgateSources(
  fetcher: FetchLike = globalThis.fetch,
  options: Pick<ToolOptions, "baseUrl" | "env"> = {},
): Promise<TollgateSourceSummary[]> {
  const response = await fetcher(new URL("/api/sources", baseUrl(options)), {
    headers: { accept: "application/json" },
  });
  const body = (await readJson(response)) as SourceApiResponse;
  if (!response.ok) {
    throw new Error(`Tollgate sources failed with HTTP ${response.status}.`);
  }
  if (!Array.isArray(body.sources)) {
    throw new Error("Tollgate sources response is missing sources.");
  }
  return body.sources
    .map(sourceSummary)
    .filter((source): source is TollgateSourceSummary => source !== null);
}
