import { createReader, type TollgateAskResult } from "@tollgate/reader";

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

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

function baseUrl(): string {
  return process.env.TOLLGATE_BASE_URL ?? "http://127.0.0.1:3000";
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  options: { paidFetch?: FetchLike; fetch?: FetchLike } = {},
): Promise<TollgateAskResult> {
  const url = baseUrl();
  const reader = options.paidFetch
    ? createReader({ baseUrl: url, paidFetch: options.paidFetch })
    : createReader({ baseUrl: url, ...(options.fetch ? { fetch: options.fetch } : {}) });
  return reader.ask(question);
}

export async function tollgateSources(
  fetcher: FetchLike = globalThis.fetch,
): Promise<TollgateSourceSummary[]> {
  const response = await fetcher(new URL("/api/sources", baseUrl()), {
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
