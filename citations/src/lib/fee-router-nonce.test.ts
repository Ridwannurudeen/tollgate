import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, PublicClient } from "viem";
import {
  resetFeeRouterNonceStateForTests,
  withReservedNonce,
} from "./fee-router-nonce";

const ACCOUNT = {
  address: "0x7777777777777777777777777777777777777777" as Address,
};

function publicClient(startNonce: number): PublicClient {
  return {
    getTransactionCount: vi.fn(async () => startNonce),
  } as unknown as PublicClient;
}

describe("withReservedNonce", () => {
  beforeEach(() => {
    resetFeeRouterNonceStateForTests();
    delete process.env.LEPTONWEB_FEE_ROUTER_NONCE_CONCURRENCY;
  });

  it("reserves strictly increasing nonces for concurrent calls on one account", async () => {
    const client = publicClient(41);
    const nonces = await Promise.all([
      withReservedNonce(client, ACCOUNT, async (nonce) => nonce),
      withReservedNonce(client, ACCOUNT, async (nonce) => nonce),
    ]);

    expect(nonces.sort((left, right) => left - right)).toEqual([41, 42]);
    expect(client.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a nonce after a failed submission task", async () => {
    const client = publicClient(10);
    const seen: number[] = [];

    await expect(
      withReservedNonce(client, ACCOUNT, async (nonce) => {
        seen.push(nonce);
        throw new Error("rpc rejected");
      }),
    ).rejects.toThrow("rpc rejected");
    const next = await withReservedNonce(client, ACCOUNT, async (nonce) => {
      seen.push(nonce);
      return nonce;
    });

    expect(next).toBe(11);
    expect(seen).toEqual([10, 11]);
    expect(client.getTransactionCount).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent submission tasks", async () => {
    process.env.LEPTONWEB_FEE_ROUTER_NONCE_CONCURRENCY = "2";
    const client = publicClient(100);
    let active = 0;
    let maxActive = 0;

    await Promise.all(
      Array.from({ length: 5 }, () =>
        withReservedNonce(client, ACCOUNT, async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 20));
          active -= 1;
        }),
      ),
    );

    expect(maxActive).toBe(2);
  });
});
