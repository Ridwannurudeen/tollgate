import { beforeEach, describe, expect, it } from "vitest";
import type { Hex, PublicClient } from "viem";
import { generatePrivateKey } from "viem/accounts";
import {
  EXTERNAL_PROVIDERS,
  type ExternalProviderAskOptions,
} from "./external-providers";
import type { FeeRouterWriteContractRequest } from "./fee-router";
import { resetFeeRouterNonceStateForTests } from "./fee-router-nonce";

const TEST_KEY = generatePrivateKey();

beforeEach(() => {
  resetFeeRouterNonceStateForTests();
});

describe("EXTERNAL_PROVIDERS.citepay", () => {
  it("transfers the query fee and posts the tx hash with the verified query field", async () => {
    const txHash = `0x${"a".repeat(64)}` as Hex;
    const writes: FeeRouterWriteContractRequest[] = [];
    let waitedHash: Hex | undefined;
    let postedUrl = "";
    let postedBody: unknown;
    let postedTxHash = "";
    const publicClient = {
      getTransactionCount: async () => 90,
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        waitedHash = hash;
        return { status: "success" };
      },
    } as unknown as PublicClient;
    const walletClient = {
      writeContract: async (request: FeeRouterWriteContractRequest) => {
        writes.push(request);
        return txHash;
      },
    };
    const fetchImpl: ExternalProviderAskOptions["fetch"] = async (
      input,
      init,
    ) => {
      postedUrl = input.toString();
      postedBody = JSON.parse(String(init?.body));
      postedTxHash = String(new Headers(init?.headers).get("X-Arc-Tx-Hash"));
      return new Response(
        JSON.stringify({
          queryId: "external-query-1",
          queryHash: `0x${"b".repeat(64)}`,
          answer:
            "CitePay returned a paid external grounding answer for the agent.",
          decisions: [],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const result = await EXTERNAL_PROVIDERS.citepay.ask(
      "What did the agent need to verify?",
      {
        privateKey: TEST_KEY,
        publicClient,
        walletClient,
        fetch: fetchImpl,
      },
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      functionName: "transfer",
      args: ["0x5389688243328c26a92b301faEEAb5fbf9AFf105", 1_000n],
      nonce: 90,
    });
    expect(waitedHash).toBe(txHash);
    expect(postedUrl).toBe("https://citepay-markets.vercel.app/api/ask");
    expect(postedBody).toEqual({
      query: "What did the agent need to verify?",
    });
    expect(postedTxHash).toBe(txHash);
    expect(result.answer).toContain("paid external grounding");
    expect(result.assist).toMatchObject({
      provider: "citepay",
      amountAtomicUsdc: 1_000,
      transaction: txHash,
      queryId: "external-query-1",
      queryHash: `0x${"b".repeat(64)}`,
    });
    expect(result.assist.answerHash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
