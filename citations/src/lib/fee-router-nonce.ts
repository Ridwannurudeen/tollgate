import { BaseError, NonceTooLowError } from "viem";
import type { Address, PublicClient } from "viem";

type FeeRouterNonceAccount = {
  address: Address;
};

type NonceState = {
  nextNonce?: number;
  queue: Promise<void>;
};

const nonceStates = new Map<string, NonceState>();
const DEFAULT_MAX_IN_FLIGHT = 4;
let inFlight = 0;
const waiters: Array<() => void> = [];

// The reserved nonce is cached per account and only reconciled on failure, so
// anything else signing from the same address — the x402 facilitator shares this
// key — moves the chain ahead of the cache and the next submission is rejected.
// The node rejects a too-low nonce before it reaches the mempool, so that one
// case is safe to resubmit; every other failure may already be in flight.
function isNonceTooLow(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk((cause) => cause instanceof NonceTooLowError) instanceof
      NonceTooLowError
  );
}

function nonceConcurrencyLimit(): number {
  const raw = Number(process.env.LEPTONWEB_FEE_ROUTER_NONCE_CONCURRENCY);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_IN_FLIGHT;
}

function acquireSubmissionSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      inFlight += 1;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        inFlight -= 1;
        const next = waiters.shift();
        if (next) next();
      });
    };
    if (inFlight < nonceConcurrencyLimit()) {
      grant();
    } else {
      waiters.push(grant);
    }
  });
}

export function withReservedNonce<T>(
  publicClient: PublicClient,
  account: FeeRouterNonceAccount,
  task: (nonce: number) => Promise<T>,
): Promise<T> {
  const key = account.address.toLowerCase();
  const state = nonceStates.get(key) ?? { queue: Promise.resolve() };
  nonceStates.set(key, state);
  const run = state.queue.then(async () => {
    if (state.nextNonce === undefined) {
      state.nextNonce = await publicClient.getTransactionCount({
        address: account.address,
        blockTag: "pending",
      });
    }
    const nonce = state.nextNonce;
    state.nextNonce += 1;
    const release = await acquireSubmissionSlot();
    try {
      return await task(nonce);
    } catch (error) {
      try {
        state.nextNonce = await publicClient.getTransactionCount({
          address: account.address,
          blockTag: "pending",
        });
      } catch (reconciliationError) {
        delete state.nextNonce;
        throw new AggregateError(
          [error, reconciliationError],
          "FeeRouter submission and nonce reconciliation both failed.",
        );
      }
      if (isNonceTooLow(error)) {
        const reconciled = state.nextNonce;
        state.nextNonce += 1;
        return await task(reconciled);
      }
      throw error;
    } finally {
      release();
    }
  });
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function resetFeeRouterNonceStateForTests(): void {
  nonceStates.clear();
  inFlight = 0;
  waiters.splice(0, waiters.length);
}
