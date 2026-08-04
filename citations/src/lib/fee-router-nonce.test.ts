import { beforeEach, describe, expect, it, vi } from "vitest";
import { BaseError, NonceTooLowError } from "viem";
import type { Address, PublicClient } from "viem";
import {
  resetFeeRouterNonceStateForTests,
  withReservedNonce,
} from "./fee-router-nonce";

const ACCOUNT = {
  address: "0x7777777777777777777777777777777777777777" as Address,
};

function publicClient(...nonces: number[]): PublicClient {
  let index = 0;
  return {
    getTransactionCount: vi.fn(async () => {
      const nonce = nonces[Math.min(index, nonces.length - 1)];
      index += 1;
      if (nonce === undefined) throw new Error("missing test nonce");
      return nonce;
    }),
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

  it("reconciles a nonce after a pre-broadcast submission failure", async () => {
    const client = publicClient(10, 10);
    const seen: number[] = [];

    await expect(
      withReservedNonce(client, ACCOUNT, async (nonce) => {
        seen.push(nonce);
        throw new Error("rpc rejected");
      }),
    ).rejects.toThrow("rpc rejected");
    await withReservedNonce(client, ACCOUNT, async (nonce) => {
      seen.push(nonce);
    });

    expect(seen).toEqual([10, 10]);
    expect(client.getTransactionCount).toHaveBeenCalledTimes(2);
  });

  it("retries once when another signer on the account moved the nonce ahead", async () => {
    const client = publicClient(10, 12);
    const seen: number[] = [];

    const nonce = await withReservedNonce(client, ACCOUNT, async (reserved) => {
      seen.push(reserved);
      if (reserved === 10) {
        throw new BaseError("write failed", {
          cause: new NonceTooLowError({}),
        });
      }
      return reserved;
    });

    expect(seen).toEqual([10, 12]);
    expect(nonce).toBe(12);
  });

  it("keeps queued calls on one state when reconciliation also fails", async () => {
    const getTransactionCount = vi
      .fn()
      .mockResolvedValueOnce(10)
      .mockRejectedValueOnce(new Error("nonce rpc unavailable"))
      .mockResolvedValueOnce(10);
    const client = { getTransactionCount } as unknown as PublicClient;
    const seen: number[] = [];

    const failed = withReservedNonce(client, ACCOUNT, async (nonce) => {
      seen.push(nonce);
      throw new Error("submission failed");
    });
    const queued = withReservedNonce(client, ACCOUNT, async (nonce) => {
      seen.push(nonce);
      return nonce;
    });

    await expect(failed).rejects.toThrow(
      "submission and nonce reconciliation both failed",
    );
    await expect(queued).resolves.toBe(10);
    await expect(
      withReservedNonce(client, ACCOUNT, async (nonce) => {
        seen.push(nonce);
        return nonce;
      }),
    ).resolves.toBe(11);
    expect(seen).toEqual([10, 10, 11]);
  });

  it("bounds concurrent submission tasks", async () => {
    process.env.LEPTONWEB_FEE_ROUTER_NONCE_CONCURRENCY = "2";
    const client = publicClient(100);
    let active = 0;
    let maxActive = 0;
    const accounts = Array.from({ length: 5 }, (_, index) => ({
      address: `0x${(index + 1).toString(16).padStart(40, "0")}` as Address,
    }));

    await Promise.all(
      accounts.map((account) =>
        withReservedNonce(client, account, async () => {
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
