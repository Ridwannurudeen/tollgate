import { describe, expect, it } from "vitest";
import {
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createQueryRecord } from "./engine";
import {
  assertSpendWithinIntent,
  assertUseIntentNotExpired,
  buildUseIntent,
  signUseIntent,
  useIntentDigest,
  useIntentDomain,
  useIntentRecord,
  useIntentTypes,
  type TollgateUseIntent,
} from "./use-intent";

const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;

function intent(): TollgateUseIntent {
  return {
    queryHash: `0x${"1".repeat(64)}` as Hex,
    candidateSetRoot: `0x${"2".repeat(64)}` as Hex,
    selectedSourcesRoot: `0x${"3".repeat(64)}` as Hex,
    decisionTraceHash: `0x${"4".repeat(64)}` as Hex,
    claimSupportRoot: `0x${"5".repeat(64)}` as Hex,
    maxSpendAtomicUsdc: 1_000n,
    expiry: 1_900_000_000n,
    nonce: 7n,
  };
}

describe("TollgateUseIntent", () => {
  it("produces a deterministic EIP-712 digest", () => {
    const first = useIntentDigest(intent(), 5_042_002, REGISTRY);
    const second = useIntentDigest(intent(), 5_042_002, REGISTRY);

    expect(first).toBe(second);
    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("round-trips a signature to the agent wallet", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signed = await signUseIntent(intent(), {
      account,
      chainId: 5_042_002,
      registryAddress: REGISTRY,
    });
    const recovered = await recoverTypedDataAddress({
      domain: useIntentDomain(5_042_002, REGISTRY),
      types: useIntentTypes,
      primaryType: "TollgateUseIntent",
      message: intent(),
      signature: signed,
    });

    expect(recovered).toBe(account.address);
  });

  it("builds roots from the query and rejects a cap below planned spend", () => {
    const query = createQueryRecord(
      "How do source-backed agent payments work?",
      "2026-07-11T00:00:00.000Z",
    );
    const planned = query.citations.reduce(
      (sum, citation) => sum + citation.amountAtomicUsdc,
      0,
    );
    const built = buildUseIntent(query, {
      chainId: 5_042_002,
      registryAddress: REGISTRY,
      maxSpendAtomicUsdc: planned,
      expiry: 1_900_000_000n,
      nonce: 11n,
    });

    expect(built.plannedSpendAtomicUsdc).toBe(planned);
    expect(built.intent.candidateSetRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(built.intent.selectedSourcesRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() =>
      buildUseIntent(query, {
        registryAddress: REGISTRY,
        maxSpendAtomicUsdc: planned - 1,
        expiry: 1_900_000_000n,
        nonce: 12n,
      }),
    ).toThrow("exceeds max");
  });

  it("rejects an expired intent and spend overrun", () => {
    const expired = intent();
    expect(() => assertUseIntentNotExpired(expired, 1_900_000_001)).toThrow(
      "expiry is in the past",
    );
    expect(() => assertSpendWithinIntent(expired, 1_001)).toThrow(
      "exceeds max",
    );
  });

  it("serializes the signed fields for the public ledger", () => {
    const built = {
      intent: intent(),
      digest: `0x${"a".repeat(64)}` as Hex,
      plannedSpendAtomicUsdc: 100,
      registryAddress: REGISTRY,
      chainId: 5_042_002,
    };
    const record = useIntentRecord(
      built,
      `0x${"b".repeat(130)}` as Hex,
      `0x${"c".repeat(64)}` as Hex,
    );

    expect(record).toMatchObject({
      digest: built.digest,
      chainId: 5_042_002,
      registryAddress: REGISTRY,
      nonce: "7",
      maxSpendAtomicUsdc: "1000",
      anchorTx: `0x${"c".repeat(64)}`,
    });
  });
});
