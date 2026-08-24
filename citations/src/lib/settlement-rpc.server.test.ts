import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generatePrivateKey } from "viem/accounts";

const httpCalls = vi.hoisted(
  () =>
    [] as Array<{
      fetchFn?: (url: string, options?: RequestInit) => Promise<Response>;
      url?: string;
    }>,
);

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    http: (url?: string, config?: { fetchFn?: typeof fetch }) => {
      httpCalls.push({
        fetchFn: config?.fetchFn as
          | ((url: string, options?: RequestInit) => Promise<Response>)
          | undefined,
        url,
      });
      return actual.http(url, config);
    },
  };
});

const previousPublicRpc = process.env.NEXT_PUBLIC_ARC_RPC_URL;
const previousSettlementRpc = process.env.ARC_SETTLEMENT_RPC_URL;
const previousSignerMode = process.env.TOLLGATE_SIGNER;

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

async function loadSettlementRpc() {
  vi.resetModules();
  return import("./settlement-rpc.server");
}

afterEach(() => {
  restore("NEXT_PUBLIC_ARC_RPC_URL", previousPublicRpc);
  restore("ARC_SETTLEMENT_RPC_URL", previousSettlementRpc);
  restore("TOLLGATE_SIGNER", previousSignerMode);
  httpCalls.splice(0, httpCalls.length);
  vi.resetModules();
});

describe("settlement RPC configuration", () => {
  it("uses the public Arc RPC unchanged when the settlement variable is unset", async () => {
    process.env.NEXT_PUBLIC_ARC_RPC_URL = "https://public-rpc.example";
    delete process.env.ARC_SETTLEMENT_RPC_URL;

    const { settlementRpcUrl, settlementTransport } = await loadSettlementRpc();

    expect(settlementRpcUrl()).toBe("https://public-rpc.example");
    settlementTransport();
    expect(httpCalls).toEqual([
      { fetchFn: undefined, url: "https://public-rpc.example" },
    ]);
  });

  it("uses the server-only settlement RPC when configured", async () => {
    process.env.NEXT_PUBLIC_ARC_RPC_URL = "https://public-rpc.example";
    process.env.ARC_SETTLEMENT_RPC_URL =
      "https://authenticated-rpc.example/secret-key";

    const { settlementRpcUrl } = await loadSettlementRpc();

    expect(settlementRpcUrl()).toBe(
      "https://authenticated-rpc.example/secret-key",
    );
  });

  it("moves embedded RPC credentials into an authorization header", async () => {
    process.env.ARC_SETTLEMENT_RPC_URL =
      "https://operator:secret-key@authenticated-rpc.example/path";
    const fetchRequest = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x1" })),
      );
    try {
      const { settlementTransport } = await loadSettlementRpc();
      const transport = settlementTransport()({});

      await transport.request({ method: "eth_chainId" }, { retryCount: 0 });

      const [url, options] = fetchRequest.mock.calls[0] ?? [];
      expect(url).toBe("https://authenticated-rpc.example/path");
      expect(new Headers(options?.headers).get("Authorization")).toBe(
        "Basic b3BlcmF0b3I6c2VjcmV0LWtleQ==",
      );
      expect(String(url)).not.toContain("secret-key");
      fetchRequest.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: -32005,
              message:
                "rate limit at https://operator:secret-key@authenticated-rpc.example/path",
            },
          }),
          {
            headers: {
              "x-rpc-error":
                "https://operator:secret-key@authenticated-rpc.example/path",
            },
            status: 429,
          },
        ),
      );
      const rpcError = await transport
        .request({ method: "eth_chainId" }, { retryCount: 0 })
        .catch((error: unknown) => error);
      expect(inspect(rpcError, { depth: 8 })).not.toContain("secret-key");
      expect(inspect(rpcError, { depth: 8 })).toContain(
        "rate limit at [redacted rpc url]",
      );
      fetchRequest.mockResolvedValueOnce(
        new Response("upstream unavailable", {
          headers: {
            "x-rpc-error":
              "https://operator:secret-key@authenticated-rpc.example/path",
          },
          status: 503,
        }),
      );
      const httpError = await transport
        .request({ method: "eth_chainId" }, { retryCount: 0 })
        .catch((error: unknown) => error);
      expect(inspect(httpError, { depth: 8 })).not.toContain("secret-key");
      expect(
        (httpError as { headers?: Headers }).headers?.get("x-rpc-error"),
      ).toBe("[redacted rpc url]");
      fetchRequest.mockRejectedValueOnce(
        new Error("request to https://operator:secret-key@example failed"),
      );
      const fetchError = await transport
        .request({ method: "eth_chainId" }, { retryCount: 0 })
        .catch((error: unknown) => error);
      expect(inspect(fetchError, { depth: 8 })).not.toContain("secret-key");
    } finally {
      fetchRequest.mockRestore();
    }
  });

  it("uses one endpoint for keystore FeeRouter nonce reads and submissions", async () => {
    const settlementUrl = "https://authenticated-rpc.example/secret-key";
    process.env.ARC_SETTLEMENT_RPC_URL = settlementUrl;
    process.env.TOLLGATE_SIGNER = "keystore";
    const { createFeeRouterPublicClient, createFeeRouterSigner } =
      await import("./fee-router");

    const publicClient = createFeeRouterPublicClient();
    createFeeRouterSigner({ privateKey: generatePrivateKey() });

    expect(httpCalls.map((call) => call.url)).toEqual([
      settlementUrl,
      settlementUrl,
    ]);
    expect(publicClient.transport.url).toBe("https://rpc.testnet.arc.network");
  });
});
