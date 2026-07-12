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

async function reserveNonce(
  publicClient: PublicClient,
  account: FeeRouterNonceAccount,
): Promise<number> {
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
    return nonce;
  });
  state.queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isNonceTooLowError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /nonce too low|lower than the current nonce/i.test(message);
}

export async function withReservedNonce<T>(
  publicClient: PublicClient,
  account: FeeRouterNonceAccount,
  task: (nonce: number) => Promise<T>,
): Promise<T> {
  const nonce = await reserveNonce(publicClient, account);
  const release = await acquireSubmissionSlot();
  try {
    return await task(nonce);
  } catch (error) {
    if (!isNonceTooLowError(error)) throw error;
    // Another process sharing this wallet advanced the chain nonce past our
    // cache. Reseed from the chain and retry once.
    nonceStates.delete(account.address.toLowerCase());
    const freshNonce = await reserveNonce(publicClient, account);
    return await task(freshNonce);
  } finally {
    release();
  }
}

export function resetFeeRouterNonceStateForTests(): void {
  nonceStates.clear();
  inFlight = 0;
  waiters.splice(0, waiters.length);
}
