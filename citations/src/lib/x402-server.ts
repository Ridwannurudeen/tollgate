import { inspect } from "node:util";
import {
  BaseError,
  createWalletClient,
  LimitExceededRpcError,
  publicActions,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import { x402Facilitator } from "@x402/core/facilitator";
import { supportsBatching } from "@circle-fin/x402-batching";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import { ExactEvmScheme as ExactEvmFacilitator } from "@x402/evm/exact/facilitator";
import { toFacilitatorEvmSigner, type FacilitatorEvmSigner } from "@x402/evm";
import {
  ARC_CAIP2,
  ARC_GATEWAY_API_URL,
  ARC_GATEWAY_WALLET,
  ARC_USDC,
  arcChain,
} from "./chain";
import { settlementTransport } from "./settlement-rpc.server";

export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";
export const GATEWAY_BATCHING_NAME = "GatewayWalletBatched";
export const GATEWAY_BATCHING_VERSION = "1";

const RATE_LIMIT_RETRY_DELAYS_MS = [250, 500] as const;
const HTTP_URL_PATTERN = /https?:\/\/[^\s'"<>]+/g;

type GatewayPaymentPayload = Parameters<BatchFacilitatorClient["verify"]>[0];
type GatewayPaymentRequirements = Parameters<
  BatchFacilitatorClient["verify"]
>[1];

export type X402Settlement =
  | {
      ok: true;
      mode: "x402-verified" | "x402-settled";
      payer?: string;
      transaction?: string;
      responseHeader: string;
    }
  | {
      ok: false;
      reason: string;
      status: number;
    };

export function buildPaymentRequirements(
  payTo: Address,
  amountAtomicUsdc: number,
): PaymentRequirements {
  if (process.env.LEPTONWEB_GATEWAY_ENABLED === "1") {
    return buildGatewayPaymentRequirements(payTo, amountAtomicUsdc);
  }
  return buildExactPaymentRequirements(payTo, amountAtomicUsdc);
}

export function buildExactPaymentRequirements(
  payTo: Address,
  amountAtomicUsdc: number,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: ARC_CAIP2,
    asset: ARC_USDC,
    amount: amountAtomicUsdc.toString(),
    payTo,
    maxTimeoutSeconds: 120,
    extra: { name: "USDC", version: "2" },
  };
}

export function buildGatewayPaymentRequirements(
  payTo: Address,
  amountAtomicUsdc: number,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: ARC_CAIP2,
    asset: ARC_USDC,
    amount: amountAtomicUsdc.toString(),
    payTo,
    maxTimeoutSeconds: 345_600,
    extra: {
      name: GATEWAY_BATCHING_NAME,
      version: GATEWAY_BATCHING_VERSION,
      verifyingContract: ARC_GATEWAY_WALLET,
    },
  };
}

export function paymentRequiredBody(
  requirements: PaymentRequirements | PaymentRequirements[],
  resourceUrl: string,
  description: string,
): PaymentRequired {
  const accepts = Array.isArray(requirements) ? requirements : [requirements];
  return {
    x402Version: 2,
    error: "X-PAYMENT required",
    resource: {
      url: resourceUrl,
      description,
      mimeType: "application/json",
    },
    accepts,
  };
}

function matchAccepted(
  claimed: PaymentRequirements | undefined,
  offered: PaymentRequirements[],
): PaymentRequirements | null {
  if (!claimed) return null;
  return (
    offered.find(
      (req) =>
        req.scheme === claimed.scheme &&
        req.network === claimed.network &&
        String(req.asset).toLowerCase() ===
          String(claimed.asset).toLowerCase() &&
        req.amount === claimed.amount &&
        String(req.payTo).toLowerCase() ===
          String(claimed.payTo).toLowerCase() &&
        (req.extra?.name ?? null) === (claimed.extra?.name ?? null),
    ) ?? null
  );
}

export function paymentRequiredHeaders(
  body: PaymentRequired,
): Record<string, string> {
  return {
    [PAYMENT_REQUIRED_HEADER]: encodePaymentRequiredHeader(body),
  };
}

// @x402/evm's settle path catches the real settlement error, regex-matches its
// message against five known cases, and collapses everything else to
// `invalid_exact_evm_transaction_failed` (parseEip3009TransferError's
// fallback) — the 2026-08-12 production outage was undiagnosable because the
// raw error died there. Log it — full viem detail and cause chain — to stderr
// before the library classifies it, redacting any configured settlement URL.
export function redactSettlementRpcUrls(value: string): string {
  if (!process.env.ARC_SETTLEMENT_RPC_URL) return value;
  return value.replace(HTTP_URL_PATTERN, "[redacted rpc url]");
}

function inspectForX402Log(value: unknown): string {
  return redactSettlementRpcUrls(inspect(value, { depth: 8 }));
}

function safeX402Error(error: unknown): unknown {
  if (!process.env.ARC_SETTLEMENT_RPC_URL) return error;
  if (!(error instanceof Error)) {
    return redactSettlementRpcUrls(inspect(error, { depth: 8 }));
  }
  const cause =
    error.cause === undefined ? undefined : safeX402Error(error.cause);
  const safe = new Error(
    redactSettlementRpcUrls(error.message),
    cause === undefined ? undefined : { cause },
  );
  safe.name = error.name;
  return safe;
}

function logRawX402Error(source: string, error: unknown): void {
  try {
    console.error(
      `[x402-raw-error] ${source} failed:`,
      inspectForX402Log(error),
    );
  } catch {
    console.error(`[x402-raw-error] ${source} failed (uninspectable error)`);
  }
}

export function isRateLimitExceeded(error: unknown): boolean {
  if (!(error instanceof BaseError)) return false;
  const limit = error.walk((cause) => cause instanceof LimitExceededRpcError);
  return (
    limit instanceof LimitExceededRpcError &&
    limit.details.trim().toLowerCase() === "rate limit exceeded"
  );
}

async function withRateLimitRetry<T>(call: () => Promise<T>): Promise<T> {
  for (const delay of RATE_LIMIT_RETRY_DELAYS_MS) {
    try {
      return await call();
    } catch (error) {
      if (!isRateLimitExceeded(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return call();
}

export function withRawErrorLogging(
  signer: FacilitatorEvmSigner,
): FacilitatorEvmSigner {
  const wrap =
    <Args extends unknown[], Result>(
      method: string,
      call: (...args: Args) => Promise<Result>,
    ) =>
    async (...args: Args): Promise<Result> => {
      try {
        return await call(...args);
      } catch (error) {
        logRawX402Error(`signer.${method}`, error);
        const safeError = safeX402Error(error);
        throw safeError;
      }
    };
  const retrySubmission =
    <Args extends unknown[], Result>(
      call: (...args: Args) => Promise<Result>,
    ) =>
    (...args: Args): Promise<Result> =>
      withRateLimitRetry(() => call(...args));
  return {
    ...signer,
    readContract: wrap("readContract", signer.readContract.bind(signer)),
    verifyTypedData: wrap(
      "verifyTypedData",
      signer.verifyTypedData.bind(signer),
    ),
    writeContract: wrap(
      "writeContract",
      retrySubmission(signer.writeContract.bind(signer)),
    ),
    sendTransaction: wrap(
      "sendTransaction",
      retrySubmission(signer.sendTransaction.bind(signer)),
    ),
    waitForTransactionReceipt: wrap(
      "waitForTransactionReceipt",
      signer.waitForTransactionReceipt.bind(signer),
    ),
    getCode: wrap("getCode", signer.getCode.bind(signer)),
  };
}

function makeFacilitator() {
  const privateKey = process.env.FACILITATOR_PRIVATE_KEY as
    | `0x${string}`
    | undefined;
  if (!privateKey) throw new Error("FACILITATOR_PRIVATE_KEY not configured");
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: arcChain,
    transport: settlementTransport(),
  }).extend(publicActions);
  const signer = toFacilitatorEvmSigner(
    client as unknown as Omit<FacilitatorEvmSigner, "getAddresses"> & {
      address: `0x${string}`;
    },
  );
  return new x402Facilitator().register(
    ARC_CAIP2,
    new ExactEvmFacilitator(withRawErrorLogging(signer)),
  );
}

function makeGatewayFacilitator() {
  return new BatchFacilitatorClient({
    url: process.env.LEPTONWEB_GATEWAY_API_URL ?? ARC_GATEWAY_API_URL,
  });
}

export async function settleX402(
  signatureHeader: string,
  accepted: PaymentRequirements | PaymentRequirements[],
): Promise<X402Settlement> {
  const offered = Array.isArray(accepted) ? accepted : [accepted];
  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(signatureHeader);
  } catch {
    return { ok: false, status: 400, reason: "malformed payment header" };
  }

  const requirements = matchAccepted(payload.accepted, offered);
  if (!requirements) {
    return {
      ok: false,
      status: 402,
      reason: "payment does not match an accepted requirement",
    };
  }

  if (supportsBatching(requirements)) {
    const facilitator = makeGatewayFacilitator();
    const gatewayPayload = payload as unknown as GatewayPaymentPayload;
    const gatewayRequirements =
      requirements as unknown as GatewayPaymentRequirements;
    const verifyRes = await facilitator.verify(
      gatewayPayload,
      gatewayRequirements,
    );
    if (!verifyRes.isValid) {
      return {
        ok: false,
        status: 402,
        reason:
          verifyRes.invalidReason ?? "Gateway payment verification failed",
      };
    }
    const settleRes = await facilitator.settle(
      gatewayPayload,
      gatewayRequirements,
    );
    if (!settleRes.success) {
      return {
        ok: false,
        status: 402,
        reason: settleRes.errorReason ?? "Gateway settlement failed",
      };
    }
    const response: SettleResponse = {
      success: true,
      transaction: settleRes.transaction ?? "",
      network: ARC_CAIP2,
      payer: settleRes.payer ?? verifyRes.payer,
    };
    return {
      ok: true,
      mode: "x402-settled",
      payer: settleRes.payer ?? verifyRes.payer,
      transaction: settleRes.transaction,
      responseHeader: encodePaymentResponseHeader(response),
    };
  }

  if (process.env.FACILITATOR_PRIVATE_KEY) {
    const facilitator = makeFacilitator();
    const verifyRes = await facilitator.verify(payload, requirements);
    if (!verifyRes.isValid) {
      console.error(
        "[x402-raw-error] exact verify rejected:",
        inspectForX402Log(verifyRes),
      );
      return {
        ok: false,
        status: 402,
        reason: redactSettlementRpcUrls(
          verifyRes.invalidReason ?? "payment verification failed",
        ),
      };
    }
    const settleRes = await facilitator.settle(payload, requirements);
    if (!settleRes.success) {
      console.error(
        "[x402-raw-error] exact settle rejected:",
        inspectForX402Log(settleRes),
      );
      return {
        ok: false,
        status: 402,
        reason: redactSettlementRpcUrls(
          settleRes.errorReason ?? "settlement failed",
        ),
      };
    }
    return {
      ok: true,
      mode: "x402-settled",
      payer: settleRes.payer,
      transaction: settleRes.transaction,
      responseHeader: encodePaymentResponseHeader(settleRes),
    };
  }

  return {
    ok: false,
    status: 503,
    reason: "x402 settlement is not configured",
  };
}
