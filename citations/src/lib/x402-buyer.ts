import { decodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentRequirements } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_CAIP2 } from "./chain";
import {
  EscalationPaidError,
  type ExternalProvider,
  type ExternalProviderAnswer,
  type ExternalProviderAskOptions,
} from "./external-providers";
import { sha256Hex } from "./hash";
import { readLedger } from "./ledger";
import type { ExternalAssist, Ledger } from "./types";

const PAYMENT_RESPONSE_HEADERS = ["PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"];
const ASK_TIMEOUT_MS = 20_000;

export type X402Endpoint = {
  id: string;
  label: string;
  url: string;
  maxPriceAtomicUsdc: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function textField(value: unknown, maxLength: number): string | undefined {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : undefined;
}

// Spending config is parsed strictly: a malformed allowlist must fail loudly
// rather than silently degrade into paying the wrong endpoint or no cap.
export function parseX402Endpoints(raw: string | undefined): X402Endpoint[] {
  const value = raw?.trim();
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("LEPTONWEB_X402_ENDPOINTS must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("LEPTONWEB_X402_ENDPOINTS must be a JSON array.");
  }
  return parsed.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`LEPTONWEB_X402_ENDPOINTS[${index}] must be an object.`);
    }
    const id = textField(entry.id, 64);
    const label = textField(entry.label, 64);
    const url = textField(entry.url, 400);
    const maxPriceAtomicUsdc = entry.maxPriceAtomicUsdc;
    if (!id || !label || !url) {
      throw new Error(
        `LEPTONWEB_X402_ENDPOINTS[${index}] needs id, label, and url.`,
      );
    }
    if (!/^https:\/\//i.test(url)) {
      throw new Error(
        `LEPTONWEB_X402_ENDPOINTS[${index}].url must be an https URL.`,
      );
    }
    if (
      typeof maxPriceAtomicUsdc !== "number" ||
      !Number.isInteger(maxPriceAtomicUsdc) ||
      maxPriceAtomicUsdc <= 0
    ) {
      throw new Error(
        `LEPTONWEB_X402_ENDPOINTS[${index}].maxPriceAtomicUsdc must be a positive integer.`,
      );
    }
    return { id, label, url, maxPriceAtomicUsdc };
  });
}

export function x402DailyCapAtomicUsdc(): number {
  const raw = process.env.LEPTONWEB_X402_DAILY_CAP_ATOMIC ?? "10000";
  const cap = Number(raw);
  return Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : 0;
}

export function externalSpendOnDate(ledger: Ledger, isoDate: string): number {
  return ledger.queries.reduce((sum, query) => {
    if (!query.createdAt.startsWith(isoDate)) return sum;
    return (
      sum +
      (query.externalAssists ?? []).reduce(
        (assistSum, assist) => assistSum + assist.amountAtomicUsdc,
        0,
      )
    );
  }, 0);
}

// Keeps at most the single cheapest requirement that is within cap, so the
// amount the agent authorises is always known exactly before it signs.
export function selectAffordableRequirement(
  requirements: PaymentRequirements[],
  maxPriceAtomicUsdc: number,
): PaymentRequirements[] {
  const affordable = requirements
    .filter((requirement) => {
      if (requirement.network !== ARC_CAIP2) return false;
      const amount = Number(requirement.amount);
      return (
        Number.isInteger(amount) && amount > 0 && amount <= maxPriceAtomicUsdc
      );
    })
    .sort((left, right) => Number(left.amount) - Number(right.amount));
  return affordable.length > 0 ? [affordable[0]] : [];
}

function buyerPrivateKey(options: ExternalProviderAskOptions): `0x${string}` {
  const key =
    options.privateKey ?? process.env.LEPTONWEB_X402_BUYER_PRIVATE_KEY;
  if (!key) {
    throw new Error("LEPTONWEB_X402_BUYER_PRIVATE_KEY is not configured.");
  }
  return key as `0x${string}`;
}

function decodeSettlement(
  response: Response,
): { transaction: `0x${string}`; amountAtomicUsdc?: number } | null {
  for (const name of PAYMENT_RESPONSE_HEADERS) {
    const header = response.headers.get(name);
    if (!header) continue;
    try {
      const settled = decodePaymentResponseHeader(header);
      if (!settled.success) return null;
      if (!/^0x[0-9a-fA-F]{64}$/.test(settled.transaction)) return null;
      const amount = Number(settled.amount);
      return {
        transaction: settled.transaction as `0x${string}`,
        ...(Number.isInteger(amount) && amount > 0
          ? { amountAtomicUsdc: amount }
          : {}),
      };
    } catch {
      return null;
    }
  }
  return null;
}

async function askX402Endpoint(
  endpoint: X402Endpoint,
  question: string,
  options: ExternalProviderAskOptions = {},
): Promise<ExternalProviderAnswer> {
  const dailyCap = x402DailyCapAtomicUsdc();
  const ledger = await readLedger();
  const today = new Date().toISOString().slice(0, 10);
  const spentToday = externalSpendOnDate(ledger, today);
  if (spentToday + endpoint.maxPriceAtomicUsdc > dailyCap) {
    throw new Error(
      `x402 daily cap reached: ${spentToday} of ${dailyCap} atomic USDC already spent today.`,
    );
  }

  const account = privateKeyToAccount(buyerPrivateKey(options));
  const signer = {
    address: account.address,
    signTypedData: (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) =>
      account.signTypedData(
        message as unknown as Parameters<typeof account.signTypedData>[0],
      ),
  };
  let authorisedAtomicUsdc = 0;
  const paidFetch =
    options.fetch ??
    wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [{ network: ARC_CAIP2, client: new ExactEvmScheme(signer) }],
      policies: [
        (_version, requirements) => {
          const selected = selectAffordableRequirement(
            requirements,
            endpoint.maxPriceAtomicUsdc,
          );
          authorisedAtomicUsdc = selected[0] ? Number(selected[0].amount) : 0;
          return selected;
        },
      ],
    });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
  let response: Response;
  try {
    response = await paidFetch(endpoint.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: question }),
      signal: controller.signal,
    });
  } catch (error) {
    // No settlement header is observable on a thrown request, so no payment is
    // recorded: the x402 client only signs after a 402 it could satisfy.
    const message = error instanceof Error ? error.message : "network error";
    throw new Error(`${endpoint.label} x402 request failed: ${message}`);
  } finally {
    clearTimeout(timeout);
  }

  const settlement = decodeSettlement(response);
  if (!settlement) {
    throw new Error(
      `${endpoint.label} did not settle an x402 payment (HTTP ${response.status}).`,
    );
  }

  // Money has moved from here on: every failure below must surface the paid
  // assist so the caller records the spend instead of losing it.
  const paidAssist: ExternalAssist = {
    provider: `x402:${endpoint.id}`,
    endpoint: endpoint.url,
    amountAtomicUsdc: settlement.amountAtomicUsdc ?? authorisedAtomicUsdc,
    transaction: settlement.transaction,
    answerHash: sha256Hex(""),
  };
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new EscalationPaidError(
      `${endpoint.label} settled payment but returned HTTP ${response.status}.`,
      paidAssist,
    );
  }
  if (!isRecord(payload)) {
    throw new EscalationPaidError(
      `${endpoint.label} settled payment but returned an invalid response.`,
      paidAssist,
    );
  }
  const answer = textField(payload.answer, 1_600);
  if (!answer) {
    throw new EscalationPaidError(
      `${endpoint.label} settled payment but returned no answer.`,
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

export function x402EndpointProvider(endpoint: X402Endpoint): ExternalProvider {
  return {
    id: `x402:${endpoint.id}`,
    label: endpoint.label,
    endpoint: endpoint.url,
    priceAtomicUsdc: endpoint.maxPriceAtomicUsdc,
    ask: (question, options) => askX402Endpoint(endpoint, question, options),
  };
}

export function x402Providers(): ExternalProvider[] {
  return parseX402Endpoints(process.env.LEPTONWEB_X402_ENDPOINTS).map(
    x402EndpointProvider,
  );
}
