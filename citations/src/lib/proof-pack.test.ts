import { describe, expect, it } from "vitest";
import { buildProofPack } from "./proof-pack";

describe("judge proof pack", () => {
  it("includes the deployed commit, agent counts, settlement counts, and integrity", async () => {
    const previous = process.env.LEPTONWEB_DEPLOY_COMMIT;
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
      expect(proof.integrity).toEqual(proof.ledger.verification);
      expect(proof.ledger.valid).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.LEPTONWEB_DEPLOY_COMMIT;
      else process.env.LEPTONWEB_DEPLOY_COMMIT = previous;
    }
  });
});
