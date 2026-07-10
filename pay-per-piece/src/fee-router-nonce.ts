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

function nonceConcurrencyLimit(): number {
  const raw = Number(process.env.TOLLGATE_FEE_ROUTER_NONCE_CONCURRENCY);
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
