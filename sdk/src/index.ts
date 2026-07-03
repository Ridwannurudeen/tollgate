export type TollgateHex = `0x${string}`;

export type TollgateSettlementMode =
  | "local-proof"
  | "x402-verified"
  | "x402-settled"
  | "forum-routed"
  | "escrowed"
  | "refunded";

export type TollgateFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type TollgateSigner = {
  address: TollgateHex;
  signTypedData: (payload: unknown) => Promise<TollgateHex>;
};

export type TollgateCitation = {
  sourceId: string;
  title?: string;
  creator?: string;
  handle?: string;
  wallet?: TollgateHex;
  url?: string;
  amountAtomicUsdc?: number;
  reason?: string;
  [key: string]: unknown;
};

export type TollgateQueryPayment = {
  amountAtomicUsdc: number;
  settlementMode: TollgateSettlementMode;
  payTo: TollgateHex;
  payer?: string;
  transaction?: string;
  paymentResource: string;
  paymentHash: string;
  [key: string]: unknown;
};

export type TollgateQuery = {
  id: string;
  question: string;
  answer: string;
  queryHash: string;
  answerHash: string;
  totalAtomicUsdc: number;
  citations: TollgateCitation[];
  receiptHashes: string[];
  readerPayment?: TollgateQueryPayment;
  createdAt: string;
  [key: string]: unknown;
};

export type TollgateReceipt = {
  id: string;
  queryId: string;
  sourceId: string;
  creator: string;
  wallet: TollgateHex;
  amountAtomicUsdc: number;
  settlementMode: TollgateSettlementMode;
  queryPaymentHash?: string;
  payer?: string;
  transaction?: string;
  paymentResource?: string;
  previousHash: string;
  receiptHash: string;
  createdAt: string;
  [key: string]: unknown;
};

export type TollgateLedger = {
  queries: TollgateQuery[];
  receipts: TollgateReceipt[];
};

export type TollgateSettlementResult = {
  query: TollgateQuery;
  receipts: TollgateReceipt[];
  ledger?: TollgateLedger;
};

export type TollgateProofUrls = {
  proof: string;
  answer: string;
  answerByHash: string;
  receipts: string[];
};

export type TollgateAskResult = {
  answer: string;
  query: TollgateQuery;
  receipts: TollgateReceipt[];
  proofUrls: TollgateProofUrls;
};

type BaseReaderOptions = {
  baseUrl: string;
  fetch?: TollgateFetch;
};

export type TollgateReaderOptions =
  | (BaseReaderOptions & {
      paidFetch: TollgateFetch;
      privateKey?: never;
      signer?: never;
    })
  | (BaseReaderOptions & {
      privateKey: TollgateHex;
      signer?: never;
      paidFetch?: never;
    })
  | (BaseReaderOptions & {
      signer: TollgateSigner;
      privateKey?: never;
      paidFetch?: never;
    })
  | (BaseReaderOptions & {
      paidFetch?: never;
      privateKey?: never;
      signer?: never;
    });

export type TollgateReader = {
  ask: (question: string) => Promise<TollgateAskResult>;
};

export class TollgateReaderError extends Error {
  readonly endpoint: string;
  readonly status?: number;
  readonly responseBody?: unknown;

  constructor(
    message: string,
    details: {
      endpoint: string;
      status?: number;
      responseBody?: unknown;
    },
  ) {
    super(message);
    this.name = "TollgateReaderError";
    this.endpoint = details.endpoint;
    if ("status" in details) {
      this.status = details.status;
    }
    if ("responseBody" in details) {
      this.responseBody = details.responseBody;
    }
  }
}

export function createReader(options: TollgateReaderOptions): TollgateReader {
  const baseUrl = normalizeBaseUrl(options.baseUrl);

  return {
    ask: async (question: string) => {
      const endpointPath = options.paidFetch ? "/api/paid-query" : "/api/query";
      const endpoint = absoluteUrl(baseUrl, endpointPath);

      if (!options.paidFetch && (options.privateKey || options.signer)) {
        throw new TollgateReaderError(
          "privateKey and signer payment flows are intentionally not bundled yet. Pass an x402-capable paidFetch adapter to use /api/paid-query.",
          { endpoint: absoluteUrl(baseUrl, "/api/paid-query") },
        );
      }

      const fetcher = options.paidFetch ?? options.fetch ?? globalThis.fetch;
      if (typeof fetcher !== "function") {
        throw new TollgateReaderError("No fetch implementation is available.", {
          endpoint,
        });
      }

      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const body = await readJson(response);

      if (!response.ok) {
        throw new TollgateReaderError(
          errorMessage(body) ?? `Tollgate request failed with HTTP ${response.status}.`,
          { endpoint, status: response.status, responseBody: body },
        );
      }

      const settlement = parseSettlementResult(body);
      const receiptHashes =
        settlement.query.receiptHashes.length > 0
          ? settlement.query.receiptHashes
          : settlement.receipts.map((receipt) => receipt.receiptHash);

      return {
        answer: settlement.query.answer,
        query: settlement.query,
        receipts: settlement.receipts,
        proofUrls: {
          proof: absoluteUrl(baseUrl, "/proof"),
          answer: absoluteUrl(baseUrl, `/answers/${settlement.query.id}`),
          answerByHash: absoluteUrl(
            baseUrl,
            `/answers/${settlement.query.answerHash}`,
          ),
          receipts: receiptHashes.map((receiptHash) =>
            absoluteUrl(baseUrl, `/receipts/${receiptHash}`),
          ),
        },
      };
    },
  };
}

function normalizeBaseUrl(baseUrl: string): URL {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("baseUrl must be an absolute HTTP(S) URL.");
  }
  return parsed;
}

function absoluteUrl(baseUrl: URL, path: string): string {
  return new URL(path, baseUrl).toString();
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return typeof body.error === "string" ? body.error : null;
}

function parseSettlementResult(body: unknown): TollgateSettlementResult {
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

  const result: TollgateSettlementResult = {
    query: body.query,
    receipts: body.receipts,
  };

  if (isTollgateLedger(body.ledger)) {
    result.ledger = body.ledger;
  }

  return result;
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
    (value.readerPayment === undefined ||
      isTollgateQueryPayment(value.readerPayment)) &&
    typeof value.createdAt === "string"
  );
}

function isTollgateQueryPayment(value: unknown): value is TollgateQueryPayment {
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

function isTollgateLedger(value: unknown): value is TollgateLedger {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.queries) &&
    value.queries.every(isTollgateQuery) &&
    Array.isArray(value.receipts) &&
    value.receipts.every(isTollgateReceipt)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isHex(value: unknown): value is TollgateHex {
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
