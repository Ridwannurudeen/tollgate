import {
  decodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BaseError,
  LimitExceededRpcError,
  RpcRequestError,
  type Hex,
} from "viem";
import {
  GATEWAY_BATCHING_NAME,
  GATEWAY_BATCHING_VERSION,
  PAYMENT_REQUIRED_HEADER,
  buildExactPaymentRequirements,
  buildGatewayPaymentRequirements,
  buildPaymentRequirements,
  isRateLimitExceeded,
  paymentRequiredBody,
  paymentRequiredHeaders,
  redactSettlementRpcUrls,
  settleX402,
  withRawErrorLogging,
} from "./x402-server";
import { ARC_CAIP2, ARC_GATEWAY_WALLET, ARC_USDC } from "./chain";

const previousFacilitatorKey = process.env.FACILITATOR_PRIVATE_KEY;
const previousSettlementRpc = process.env.ARC_SETTLEMENT_RPC_URL;

beforeEach(() => {
  delete process.env.FACILITATOR_PRIVATE_KEY;
  delete process.env.ARC_SETTLEMENT_RPC_URL;
});

afterEach(() => {
  if (previousFacilitatorKey === undefined) {
    delete process.env.FACILITATOR_PRIVATE_KEY;
  } else {
    process.env.FACILITATOR_PRIVATE_KEY = previousFacilitatorKey;
  }
  if (previousSettlementRpc === undefined) {
    delete process.env.ARC_SETTLEMENT_RPC_URL;
  } else {
    process.env.ARC_SETTLEMENT_RPC_URL = previousSettlementRpc;
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

  function rateLimitError(details = "rate limit exceeded"): BaseError {
    return new BaseError("write failed", {
      cause: new LimitExceededRpcError(
        new RpcRequestError({
          body: { method: "eth_sendRawTransaction", params: ["0x00"] },
          error: { code: -32005, message: details },
          url: "https://authenticated-rpc.example/secret-key",
        }),
      ),
    });
  }

  it("matches only viem's rate-limit rejection", () => {
    expect(isRateLimitExceeded(rateLimitError())).toBe(true);
    expect(isRateLimitExceeded(rateLimitError("request too large"))).toBe(
      false,
    );
    expect(isRateLimitExceeded(new Error("rate limit exceeded"))).toBe(false);
  });

  it("redacts the settlement URL from a response reason", () => {
    process.env.ARC_SETTLEMENT_RPC_URL =
      "https://authenticated-rpc.example/secret-key";

    expect(
      redactSettlementRpcUrls(
        "settlement failed at https://authenticated-rpc.example/secret-key",
      ),
    ).toBe("settlement failed at [redacted rpc url]");
  });

  it("retries a rate-limited contract submission with bounded backoff", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const writeContract = vi
        .fn<FacilitatorEvmSigner["writeContract"]>()
        .mockRejectedValueOnce(rateLimitError())
        .mockRejectedValueOnce(rateLimitError())
        .mockResolvedValue(`0x${"1".repeat(64)}` as Hex);
      const signer = withRawErrorLogging(makeSigner({ writeContract }));

      const result = signer.writeContract({
        address: "0x3600000000000000000000000000000000000000",
        abi: [],
        functionName: "transferWithAuthorization",
        args: [],
      });
      await vi.advanceTimersByTimeAsync(750);

      await expect(result).resolves.toBe(`0x${"1".repeat(64)}`);
      expect(writeContract).toHaveBeenCalledTimes(3);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it("stops after three rate-limited submission attempts", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const raw = rateLimitError();
      const writeContract = vi
        .fn<FacilitatorEvmSigner["writeContract"]>()
        .mockRejectedValue(raw);
      const signer = withRawErrorLogging(makeSigner({ writeContract }));

      const result = expect(
        signer.writeContract({
          address: "0x3600000000000000000000000000000000000000",
          abi: [],
          functionName: "transferWithAuthorization",
          args: [],
        }),
      ).rejects.toBe(raw);
      await vi.advanceTimersByTimeAsync(750);

      await result;
      expect(writeContract).toHaveBeenCalledTimes(3);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it("retries a rate-limited smart-wallet deployment submission", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const sendTransaction = vi
        .fn<FacilitatorEvmSigner["sendTransaction"]>()
        .mockRejectedValueOnce(rateLimitError())
        .mockResolvedValue(`0x${"2".repeat(64)}` as Hex);
      const signer = withRawErrorLogging(makeSigner({ sendTransaction }));

      const result = signer.sendTransaction({
        data: "0x",
        to: "0x1111111111111111111111111111111111111111",
      });
      await vi.advanceTimersByTimeAsync(250);

      await expect(result).resolves.toBe(`0x${"2".repeat(64)}`);
      expect(sendTransaction).toHaveBeenCalledTimes(2);
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      vi.useRealTimers();
    }
  });

  it("does not retry an unrelated submission error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const raw = new Error("transaction rejected");
      const writeContract = vi
        .fn<FacilitatorEvmSigner["writeContract"]>()
        .mockRejectedValue(raw);
      const signer = withRawErrorLogging(makeSigner({ writeContract }));

      await expect(
        signer.writeContract({
          address: "0x3600000000000000000000000000000000000000",
          abi: [],
          functionName: "transferWithAuthorization",
          args: [],
        }),
      ).rejects.toBe(raw);
      expect(writeContract).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      error.mockRestore();
    }
  });

  it("redacts a configured settlement URL from logs and thrown errors", async () => {
    process.env.ARC_SETTLEMENT_RPC_URL =
      "https://authenticated-rpc.example/secret-key";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const raw = Object.assign(
        new Error(
          "HTTP request failed.\n\nURL: https://authenticated-rpc.example/secret-key",
        ),
        {
          details: "rate limit exceeded",
          cause: new Error(
            "fetch https://authenticated-rpc.example/secret-key failed",
          ),
        },
      );
      const signer = withRawErrorLogging(
        makeSigner({ writeContract: () => Promise.reject(raw) }),
      );

      const thrown = await signer
        .writeContract({
          address: "0x3600000000000000000000000000000000000000",
          abi: [],
          functionName: "transferWithAuthorization",
          args: [],
        })
        .catch((caught: unknown) => caught);
      const logged = error.mock.calls.flat().join(" ");

      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).not.toContain("secret-key");
      expect(logged).not.toContain("secret-key");
      expect(logged).not.toContain("authenticated-rpc.example");
      expect(logged).toContain("rate limit exceeded");
    } finally {
      error.mockRestore();
    }
  });

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
