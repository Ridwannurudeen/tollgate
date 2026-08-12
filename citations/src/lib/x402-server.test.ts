import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type { FacilitatorEvmSigner } from "@x402/evm";
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
  withRawErrorLogging,
} from "./x402-server";
import { ARC_CAIP2, ARC_GATEWAY_WALLET, ARC_USDC } from "./chain";

const previousFacilitatorKey = process.env.FACILITATOR_PRIVATE_KEY;

beforeEach(() => {
  delete process.env.FACILITATOR_PRIVATE_KEY;
});

afterEach(() => {
  if (previousFacilitatorKey === undefined) {
    delete process.env.FACILITATOR_PRIVATE_KEY;
  } else {
    process.env.FACILITATOR_PRIVATE_KEY = previousFacilitatorKey;
  }
});

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

  it("fails closed when exact settlement is not configured", async () => {
    const requirements = buildExactPaymentRequirements(
      "0x1111111111111111111111111111111111111111",
      1800,
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
});

describe("withRawErrorLogging", () => {
  function makeSigner(
    overrides: Partial<FacilitatorEvmSigner>,
  ): FacilitatorEvmSigner {
    const unusedCall = () => {
      throw new Error("unused signer method called");
    };
    return {
      getAddresses: () => ["0x1111111111111111111111111111111111111111"],
      readContract: unusedCall,
      verifyTypedData: unusedCall,
      writeContract: unusedCall,
      sendTransaction: unusedCall,
      waitForTransactionReceipt: unusedCall,
      getCode: unusedCall,
      ...overrides,
    };
  }

  it("logs the raw error with its cause chain, then rethrows it unchanged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const raw = Object.assign(
        new Error(
          "HTTP request failed.\n\nStatus: 503\nURL: https://rpc.example",
        ),
        {
          details: "txpool is full",
          cause: new Error("fetch failed"),
        },
      );
      const signer = withRawErrorLogging(
        makeSigner({
          writeContract: () => Promise.reject(raw),
        }),
      );

      await expect(
        signer.writeContract({
          address: "0x3600000000000000000000000000000000000000",
          abi: [],
          functionName: "transferWithAuthorization",
          args: [],
        }),
      ).rejects.toBe(raw);

      expect(error).toHaveBeenCalledTimes(1);
      const [prefix, detail] = error.mock.calls[0];
      expect(prefix).toBe("[x402-raw-error] signer.writeContract failed:");
      expect(detail).toContain("HTTP request failed.");
      expect(detail).toContain("txpool is full");
      expect(detail).toContain("fetch failed");
    } finally {
      error.mockRestore();
    }
  });

  it("passes successful calls through without logging", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const signer = withRawErrorLogging(
        makeSigner({
          getCode: () => Promise.resolve("0x6001"),
        }),
      );

      await expect(
        signer.getCode({
          address: "0x3600000000000000000000000000000000000000",
        }),
      ).resolves.toBe("0x6001");
      expect(signer.getAddresses()).toEqual([
        "0x1111111111111111111111111111111111111111",
      ]);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
