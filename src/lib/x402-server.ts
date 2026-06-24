import {
  createPublicClient,
  createWalletClient,
  http,
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
  ARC_CHAIN_ID,
  ARC_GATEWAY_API_URL,
  ARC_GATEWAY_WALLET,
  ARC_RPC_URL,
  ARC_USDC,
  USDC_DECIMALS,
  arcTestnet,
} from "./chain";

export const PAYMENT_SIGNATURE_HEADER = "PAYMENT-SIGNATURE";
export const PAYMENT_REQUIRED_HEADER = "PAYMENT-REQUIRED";
export const PAYMENT_RESPONSE_HEADER = "PAYMENT-RESPONSE";
export const GATEWAY_BATCHING_NAME = "GatewayWalletBatched";
export const GATEWAY_BATCHING_VERSION = "1";

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

export function publicOrigin(headers: Headers, fallbackOrigin: string): string {
  const host = headers.get("host");
  if (!host) return fallbackOrigin;
  const proto =
    headers.get("x-forwarded-proto") ??
    new URL(fallbackOrigin).protocol.replace(":", "");
  return `${proto}://${host}`;
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

function makeFacilitator() {
  const privateKey = process.env.FACILITATOR_PRIVATE_KEY as
    | `0x${string}`
    | undefined;
  if (!privateKey) throw new Error("FACILITATOR_PRIVATE_KEY not configured");
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  }).extend(publicActions);
  const signer = toFacilitatorEvmSigner(
    client as unknown as Omit<FacilitatorEvmSigner, "getAddresses"> & {
      address: `0x${string}`;
    },
  );
  return new x402Facilitator().register(
    ARC_CAIP2,
    new ExactEvmFacilitator(signer),
  );
}

function makeGatewayFacilitator() {
  return new BatchFacilitatorClient({
    url: process.env.LEPTONWEB_GATEWAY_API_URL ?? ARC_GATEWAY_API_URL,
  });
}

async function verifyOnly(
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<{ ok: boolean; payer?: string; reason?: string }> {
  const auth = (payload.payload as { authorization?: Record<string, unknown> })
    .authorization;
  if (!auth) return { ok: false, reason: "missing EIP-3009 authorization" };
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
  const valid = await publicClient.verifyTypedData({
    address: auth.from as `0x${string}`,
    domain: {
      name: requirements.extra.name as string,
      version: requirements.extra.version as string,
      chainId: ARC_CHAIN_ID,
      verifyingContract: requirements.asset as `0x${string}`,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from as `0x${string}`,
      to: auth.to as `0x${string}`,
      value: BigInt(auth.value as string),
      validAfter: BigInt(auth.validAfter as string),
      validBefore: BigInt(auth.validBefore as string),
      nonce: auth.nonce as `0x${string}`,
    },
    signature: (payload.payload as { signature: `0x${string}` }).signature,
  });
  return {
    ok: valid,
    payer: auth.from as string,
    reason: valid ? undefined : "invalid signature",
  };
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
      return {
        ok: false,
        status: 402,
        reason: verifyRes.invalidReason ?? "payment verification failed",
      };
    }
    const settleRes = await facilitator.settle(payload, requirements);
    if (!settleRes.success) {
      return {
        ok: false,
        status: 402,
        reason: settleRes.errorReason ?? "settlement failed",
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

  const verified = await verifyOnly(payload, requirements);
  if (!verified.ok) {
    return {
      ok: false,
      status: 402,
      reason: verified.reason ?? "payment verification failed",
    };
  }
  const response: SettleResponse = {
    success: true,
    transaction: "",
    network: ARC_CAIP2,
    payer: verified.payer,
  };
  return {
    ok: true,
    mode: "x402-verified",
    payer: verified.payer,
    responseHeader: encodePaymentResponseHeader(response),
  };
}
