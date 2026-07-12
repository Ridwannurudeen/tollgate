import { afterEach, describe, expect, it } from "vitest";
import { buildProofPack } from "./proof-pack";

describe("judge proof pack", () => {
  const previousPayGate = process.env.LEPTONWEB_PAYGATE_ADDRESS;

  afterEach(() => {
    if (previousPayGate === undefined) {
      delete process.env.LEPTONWEB_PAYGATE_ADDRESS;
    } else {
      process.env.LEPTONWEB_PAYGATE_ADDRESS = previousPayGate;
    }
  });

  it("includes the deployed commit, agent counts, settlement counts, and integrity", async () => {
    const previous = process.env.LEPTONWEB_DEPLOY_COMMIT;
    delete process.env.LEPTONWEB_PAYGATE_ADDRESS;
    process.env.LEPTONWEB_DEPLOY_COMMIT = "test-commit";

    try {
      const proof = await buildProofPack();

      expect(proof.deployedCommit).toBe("test-commit");
      expect(proof.agent).toMatchObject({
        llmRuns: expect.any(Number),
        deterministicRuns: expect.any(Number),
        buyDecisions: expect.any(Number),
        skipDecisions: expect.any(Number),
        abstentions: expect.any(Number),
        refundedSources: expect.any(Number),
      });
      expect(proof.settlement.readerPayments.count).toBeGreaterThanOrEqual(0);
      expect(proof.settlement.feeRouterPayouts.count).toBeGreaterThanOrEqual(0);
      expect(proof.traction.paidQueries).toBe(
        proof.traction.actorMetrics.independent.paymentCount,
      );
      expect(proof.traction.totalPaidQueries).toBe(
        proof.traction.actorMetrics.total.paymentCount,
      );
      expect(proof.traction.uniquePayerWallets).toBe(
        proof.traction.actorMetrics.independent.uniquePayerWallets,
      );
      expect(proof.traction.totalUniquePayerWallets).toBe(
        proof.traction.actorMetrics.total.uniquePayerWallets,
      );
      // With the env var unset, payGateAddress is null but the field still
      // surfaces historical PayGate settlements recorded in the ledger, so a
      // deployment that later disables PayGate keeps reporting its past use.
      expect(proof.useIntent.payGateAddress ?? null).toBeNull();
      expect(proof.useIntent.payGateSettledCount).toBeGreaterThanOrEqual(0);
      expect(proof.integrity).toEqual(proof.ledger.verification);
      expect(proof.ledger.valid).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.LEPTONWEB_DEPLOY_COMMIT;
      else process.env.LEPTONWEB_DEPLOY_COMMIT = previous;
    }
  });

  it("reports valid PayGate configuration and rejects malformed addresses", async () => {
    process.env.LEPTONWEB_PAYGATE_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    await expect(buildProofPack()).resolves.toMatchObject({
      useIntent: {
        payGateAddress: "0x1111111111111111111111111111111111111111",
      },
    });

    process.env.LEPTONWEB_PAYGATE_ADDRESS = "invalid";
    await expect(buildProofPack()).rejects.toThrow(
      "LEPTONWEB_PAYGATE_ADDRESS must be a 20-byte EVM address",
    );
  });
});
