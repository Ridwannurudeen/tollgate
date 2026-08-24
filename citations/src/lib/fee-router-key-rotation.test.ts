import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex, PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  withFeeRouterSigner,
  type FeeRouterWalletClient,
  type FeeRouterWriteContractRequest,
} from "./fee-router";
import { FEE_ROUTER_ADDRESS } from "./fee-router-contract";
import { rotateFeeRouterKeystoreSigner } from "./fee-router-key-rotation";
import { resetFeeRouterNonceStateForTests } from "./fee-router-nonce";

const OUTGOING_KEY = generatePrivateKey();
const INCOMING_KEY = generatePrivateKey();
const OUTGOING = privateKeyToAccount(OUTGOING_KEY).address;
const INCOMING = privateKeyToAccount(INCOMING_KEY).address;
const PAY_GATE = "0x1111111111111111111111111111111111111111" as Address;
const APPROVAL_TX = `0x${"a".repeat(64)}` as Hex;
const envNames = [
  "LEPTONWEB_FEE_ROUTER_PRIVATE_KEY",
  "LEPTONWEB_PAYGATE_ADDRESS",
  "LEPTONWEB_USE_INTENT_ENABLED",
  "LEPTONWEB_USE_INTENT_PRIVATE_KEY",
  "TOLLGATE_SIGNER",
] as const;
let previousEnv: Record<(typeof envNames)[number], string | undefined>;

beforeEach(() => {
  previousEnv = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  ) as typeof previousEnv;
  process.env.LEPTONWEB_FEE_ROUTER_PRIVATE_KEY = OUTGOING_KEY;
  process.env.LEPTONWEB_PAYGATE_ADDRESS = PAY_GATE;
  delete process.env.LEPTONWEB_USE_INTENT_ENABLED;
  delete process.env.LEPTONWEB_USE_INTENT_PRIVATE_KEY;
  process.env.TOLLGATE_SIGNER = "keystore";
  resetFeeRouterNonceStateForTests();
});

afterEach(() => {
  for (const name of envNames) {
    const value = previousEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function rotationClients(
  allowances = new Map<Address, bigint>([
    [FEE_ROUTER_ADDRESS, 1_000_000n],
    [PAY_GATE, 1_000_000n],
  ]),
) {
  const writes: FeeRouterWriteContractRequest[] = [];
  const publicClient = {
    readContract: vi.fn(
      async ({ args }: { args?: readonly unknown[] }) =>
        allowances.get(args?.[1] as Address) ?? 0n,
    ),
    getTransactionCount: vi.fn(async () => 70),
    waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: Hex }) => ({
      status: "success",
      transactionHash: hash,
    })),
  } as unknown as PublicClient;
  const walletClient: FeeRouterWalletClient = {
    writeContract: vi.fn(async (request) => {
      writes.push(request);
      return APPROVAL_TX;
    }),
  };
  return { publicClient, walletClient, writes };
}

describe("rotateFeeRouterKeystoreSigner", () => {
  it("drains the outgoing signer, revokes both allowances, and activates the incoming signer", async () => {
    const { publicClient, walletClient, writes } = rotationClients();
    let releaseOperation!: () => void;
    let operationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      operationStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const operation = withFeeRouterSigner({}, async (signer) => {
      operationStarted();
      await held;
      return signer.account.address;
    });
    await started;

    const rotation = rotateFeeRouterKeystoreSigner(INCOMING_KEY, {
      publicClient,
      walletClient,
    });
    await Promise.resolve();
    expect(writes).toEqual([]);

    releaseOperation();
    await expect(operation).resolves.toBe(OUTGOING);
    await expect(rotation).resolves.toEqual({
      outgoingAddress: OUTGOING,
      incomingAddress: INCOMING,
      revokedSpenders: [FEE_ROUTER_ADDRESS, PAY_GATE],
    });
    expect(writes.map((write) => write.args)).toEqual([
      [FEE_ROUTER_ADDRESS, 0n],
      [PAY_GATE, 0n],
    ]);
    expect(writes.map((write) => write.nonce)).toEqual([70, 71]);
    expect(
      writes.every(
        (write) => (write.account as { address: Address }).address === OUTGOING,
      ),
    ).toBe(true);
    await expect(
      withFeeRouterSigner({}, async (signer) => signer.account.address),
    ).resolves.toBe(INCOMING);
  });

  it("does not submit revocations for zero allowances", async () => {
    const clients = rotationClients(new Map());

    const result = await rotateFeeRouterKeystoreSigner(INCOMING_KEY, clients);

    expect(result.revokedSpenders).toEqual([]);
    expect(clients.writes).toEqual([]);
  });

  it("keeps the outgoing key active when a revocation fails", async () => {
    const clients = rotationClients();
    Object.assign(clients.publicClient, {
      waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => ({
        status: "reverted",
        transactionHash: hash,
      }),
    });

    await expect(
      rotateFeeRouterKeystoreSigner(INCOMING_KEY, clients),
    ).rejects.toThrow("allowance revocation failed");
    await expect(
      withFeeRouterSigner({}, async (signer) => signer.account.address),
    ).resolves.toBe(OUTGOING);
  });

  it("rejects W3S mode, identical accounts, and an unsafe use-intent fallback", async () => {
    const clients = rotationClients();
    process.env.TOLLGATE_SIGNER = "w3s";
    await expect(
      rotateFeeRouterKeystoreSigner(INCOMING_KEY, clients),
    ).rejects.toThrow("keystore mode");

    process.env.TOLLGATE_SIGNER = "keystore";
    await expect(
      rotateFeeRouterKeystoreSigner(OUTGOING_KEY, clients),
    ).rejects.toThrow("different account");

    process.env.LEPTONWEB_USE_INTENT_ENABLED = "1";
    await expect(
      rotateFeeRouterKeystoreSigner(INCOMING_KEY, clients),
    ).rejects.toThrow("LEPTONWEB_USE_INTENT_PRIVATE_KEY");
  });
});
