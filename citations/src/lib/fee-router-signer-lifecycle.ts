import type { Address } from "viem";

type AddressedSigner = {
  account: { address: Address };
};

type SignerActivity = {
  active: number;
  idleWaiters: Array<() => void>;
};

const activities = new Map<string, SignerActivity>();
const blockedSigners = new Set<string>();
const unblockWaiters = new Map<string, Array<() => void>>();

function signerKey(address: Address): string {
  return address.toLowerCase();
}

function waitUntilUnblocked(key: string): Promise<void> {
  return new Promise((resolve) => {
    const waiters = unblockWaiters.get(key) ?? [];
    waiters.push(resolve);
    unblockWaiters.set(key, waiters);
  });
}

async function admitSigner<T extends AddressedSigner>(
  createSigner: () => T,
): Promise<{ signer: T; release: () => void }> {
  while (true) {
    const signer = createSigner();
    const key = signerKey(signer.account.address);
    if (blockedSigners.has(key)) {
      await waitUntilUnblocked(key);
      continue;
    }
    const activity = activities.get(key) ?? { active: 0, idleWaiters: [] };
    activity.active += 1;
    activities.set(key, activity);
    let released = false;
    return {
      signer,
      release: () => {
        if (released) return;
        released = true;
        activity.active -= 1;
        if (activity.active === 0) {
          activities.delete(key);
          for (const resolve of activity.idleWaiters.splice(0)) resolve();
        }
      },
    };
  }
}

export async function withFeeRouterSignerOperation<
  TSigner extends AddressedSigner,
  TResult,
>(
  createSigner: () => TSigner,
  task: (signer: TSigner) => Promise<TResult>,
): Promise<TResult> {
  const { signer, release } = await admitSigner(createSigner);
  try {
    return await task(signer);
  } finally {
    release();
  }
}

export async function blockFeeRouterSignerOperations<TResult>(
  address: Address,
  task: () => Promise<TResult>,
): Promise<TResult> {
  const key = signerKey(address);
  while (blockedSigners.has(key)) await waitUntilUnblocked(key);
  blockedSigners.add(key);
  try {
    const activity = activities.get(key);
    if (activity?.active) {
      await new Promise<void>((resolve) => activity.idleWaiters.push(resolve));
    }
    return await task();
  } finally {
    blockedSigners.delete(key);
    const waiters = unblockWaiters.get(key) ?? [];
    unblockWaiters.delete(key);
    for (const resolve of waiters) resolve();
  }
}
