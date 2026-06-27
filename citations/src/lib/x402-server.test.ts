import { decodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, it } from "vitest";
import {
  GATEWAY_BATCHING_NAME,
  GATEWAY_BATCHING_VERSION,
  PAYMENT_REQUIRED_HEADER,
  buildGatewayPaymentRequirements,
  buildPaymentRequirements,
  paymentRequiredBody,
  paymentRequiredHeaders,
  publicOrigin,
} from "./x402-server";
import { ARC_CAIP2, ARC_GATEWAY_WALLET, ARC_USDC } from "./chain";

describe("x402 source gateway helpers", () => {
  it("builds Arc USDC exact payment requirements", () => {
    const requirements = buildPaymentRequirements(
      "0x1111111111111111111111111111111111111111",
      1800,
    );

    expect(requirements.scheme).toBe("exact");
    expect(requirements.network).toBe(ARC_CAIP2);
    expect(requirements.asset).toBe(ARC_USDC);
    expect(requirements.amount).toBe("1800");
    expect(requirements.payTo).toBe(
      "0x1111111111111111111111111111111111111111",
    );
  });

  it("builds Circle Gateway batched payment requirements", () => {
    const requirements = buildGatewayPaymentRequirements(
      "0x1111111111111111111111111111111111111111",
      1800,
    );

    expect(requirements.scheme).toBe("exact");
    expect(requirements.network).toBe(ARC_CAIP2);
    expect(requirements.asset).toBe(ARC_USDC);
    expect(requirements.amount).toBe("1800");
    expect(requirements.extra).toEqual({
      name: GATEWAY_BATCHING_NAME,
      version: GATEWAY_BATCHING_VERSION,
      verifyingContract: ARC_GATEWAY_WALLET,
    });
  });

  it("encodes a standards-shaped payment-required header", () => {
    const requirements = buildPaymentRequirements(
      "0x2222222222222222222222222222222222222222",
      2400,
    );
    const body = paymentRequiredBody(
      requirements,
      "https://example.com/api/sources/circle-gateway-nano",
      "Paid source access.",
    );
    const headers = paymentRequiredHeaders(body);
    const decoded = decodePaymentRequiredHeader(
      headers[PAYMENT_REQUIRED_HEADER],
    );

    expect(decoded.x402Version).toBe(2);
    expect(decoded.accepts[0]).toEqual(requirements);
    expect(decoded.resource.url).toBe(
      "https://example.com/api/sources/circle-gateway-nano",
    );
  });

  it("derives the public origin from host and x-forwarded-proto", () => {
    const headers = new Headers({
      host: "tollgate.gudman.xyz",
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(headers, "http://127.0.0.1:3091")).toBe(
      "https://tollgate.gudman.xyz",
    );
  });

  it("falls back to the bind origin when no host header is present", () => {
    expect(publicOrigin(new Headers(), "http://127.0.0.1:3091")).toBe(
      "http://127.0.0.1:3091",
    );
  });
});
