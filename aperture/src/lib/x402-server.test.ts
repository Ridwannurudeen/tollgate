import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GATEWAY_BATCHING_NAME,
  GATEWAY_BATCHING_VERSION,
  PAYMENT_REQUIRED_HEADER,
  buildExactPaymentRequirements,
  buildGatewayPaymentRequirements,
  buildPaymentRequirements,
  paymentRequiredBody,
  paymentRequiredHeaders,
  settleX402,
  x402PaymentIdentity,
} from "./x402-server";
import { ARC_CAIP2, ARC_GATEWAY_WALLET, ARC_USDC } from "./chain";

const previousFacilitatorKey = process.env.FACILITATOR_PRIVATE_KEY;

beforeEach(() => {
  delete process.env.FACILITATOR_PRIVATE_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (previousFacilitatorKey === undefined) {
    delete process.env.FACILITATOR_PRIVATE_KEY;
  } else {
    process.env.FACILITATOR_PRIVATE_KEY = previousFacilitatorKey;
  }
});

describe("Aperture x402 helpers", () => {
  it("builds Arc USDC exact payment requirements", () => {
    const requirements = buildPaymentRequirements(
      "0x1111111111111111111111111111111111111111",
      2500,
    );

    expect(requirements.scheme).toBe("exact");
    expect(requirements.network).toBe(ARC_CAIP2);
    expect(requirements.asset).toBe(ARC_USDC);
    expect(requirements.amount).toBe("2500");
    expect(requirements.payTo).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });

  it("builds Circle Gateway batched payment requirements", () => {
    const requirements = buildGatewayPaymentRequirements(
      "0x1111111111111111111111111111111111111111",
      2500,
    );

    expect(requirements.scheme).toBe("exact");
    expect(requirements.network).toBe(ARC_CAIP2);
    expect(requirements.asset).toBe(ARC_USDC);
    expect(requirements.amount).toBe("2500");
    expect(requirements.extra).toEqual({
      name: GATEWAY_BATCHING_NAME,
      version: GATEWAY_BATCHING_VERSION,
      verifyingContract: ARC_GATEWAY_WALLET,
    });
  });

  it("encodes a standards-shaped payment-required header", () => {
    const requirements = buildPaymentRequirements(
      "0x2222222222222222222222222222222222222222",
      2500,
    );
    const body = paymentRequiredBody(
      requirements,
      "https://example.com/aperture/api/license-download",
      "Paid photo license download.",
    );
    const headers = paymentRequiredHeaders(body);
    const decoded = decodePaymentRequiredHeader(
      headers[PAYMENT_REQUIRED_HEADER],
    );

    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]).toEqual(requirements);
    expect(decoded.resource.url).toBe(
      "https://example.com/aperture/api/license-download",
    );
  });

  it("fails closed when exact settlement is not configured", async () => {
    const requirements = buildExactPaymentRequirements(
      "0x1111111111111111111111111111111111111111",
      2500,
    );
    const header = encodePaymentSignatureHeader({
      x402Version: 2,
      accepted: requirements,
      payload: {
        signature: `0x${"00".repeat(65)}`,
        authorization: {
          from: "0x2222222222222222222222222222222222222222",
          to: requirements.payTo,
          value: requirements.amount,
          validAfter: "0",
          validBefore: "9999999999",
          nonce: `0x${"11".repeat(32)}`,
        },
      },
    });

    const result = await settleX402(header, requirements);

    expect(result).toEqual({
      ok: false,
      status: 503,
      reason: "x402 settlement is not configured",
    });
  });

  it("derives one canonical identity from equivalent payment payload encodings", () => {
    const requirements = buildExactPaymentRequirements(
      "0x1111111111111111111111111111111111111111",
      2500,
    );
    const payment = {
      x402Version: 2 as const,
      accepted: requirements,
      payload: {
        signature: `0x${"00".repeat(65)}`,
        authorization: {
          from: "0x2222222222222222222222222222222222222222",
          to: requirements.payTo,
          value: requirements.amount,
          validAfter: "0",
          validBefore: "9999999999",
          nonce: `0x${"11".repeat(32)}`,
        },
      },
    };
    const reordered = {
      payload: payment.payload,
      accepted: payment.accepted,
      x402Version: payment.x402Version,
    };

    const first = encodePaymentSignatureHeader(payment);
    const second = encodePaymentSignatureHeader(reordered);

    expect(first).not.toBe(second);
    expect(x402PaymentIdentity(first)).toBe(x402PaymentIdentity(second));
    expect(x402PaymentIdentity("not-base64")).toBeNull();
  });

  it("loads protected media after verification and before Gateway settlement", async () => {
    const requirements = buildGatewayPaymentRequirements(
      "0x1111111111111111111111111111111111111111",
      2500,
    );
    const header = encodePaymentSignatureHeader({
      x402Version: 2,
      accepted: requirements,
      payload: {
        signature: `0x${"00".repeat(65)}`,
        authorization: {
          from: "0x2222222222222222222222222222222222222222",
          to: requirements.payTo,
          value: requirements.amount,
          validAfter: "0",
          validBefore: "9999999999",
          nonce: `0x${"11".repeat(32)}`,
        },
      },
    });
    const order: string[] = [];
    vi.spyOn(
      BatchFacilitatorClient.prototype,
      "verify",
    ).mockImplementation(async () => {
      order.push("verify");
      return {
        isValid: true,
        payer: "0x2222222222222222222222222222222222222222",
      };
    });
    vi.spyOn(
      BatchFacilitatorClient.prototype,
      "settle",
    ).mockImplementation(async () => {
      order.push("settle");
      return {
        success: true,
        payer: "0x2222222222222222222222222222222222222222",
        transaction: `0x${"33".repeat(32)}`,
        network: ARC_CAIP2,
      };
    });

    const result = await settleX402(header, requirements, async () => {
      order.push("media");
    });

    expect(result.ok).toBe(true);
    expect(order).toEqual(["verify", "media", "settle"]);
  });
});
