import { describe, expect, it } from "vitest";
import { DEFAULT_CREATOR_SOURCES } from "./catalog";
import {
  isSponsoredJudgePayment,
  JUDGE_DEMO_CANDIDATES,
  JUDGE_DEMO_QUESTION,
  JUDGE_DEMO_SOURCE_IDS,
} from "./judge-demo";

describe("judge demo profile", () => {
  it("pins five distinct registered candidates", () => {
    const registered = new Set(DEFAULT_CREATOR_SOURCES.map((source) => source.id));

    expect(JUDGE_DEMO_QUESTION.length).toBeGreaterThan(8);
    expect(JUDGE_DEMO_CANDIDATES).toHaveLength(5);
    expect(new Set(JUDGE_DEMO_SOURCE_IDS).size).toBe(5);
    expect(JUDGE_DEMO_SOURCE_IDS.every((sourceId) => registered.has(sourceId))).toBe(
      true,
    );
  });

  it("activates only for the verified sponsored payer and fixed question", () => {
    const previous = process.env.CIRCLE_PAYER_ADDRESS;
    process.env.CIRCLE_PAYER_ADDRESS =
      "0x1111111111111111111111111111111111111111";
    try {
      expect(
        isSponsoredJudgePayment(
          JUDGE_DEMO_QUESTION,
          "0x1111111111111111111111111111111111111111",
        ),
      ).toBe(true);
      expect(
        isSponsoredJudgePayment(
          JUDGE_DEMO_QUESTION,
          "0x2222222222222222222222222222222222222222",
        ),
      ).toBe(false);
      expect(
        isSponsoredJudgePayment(
          "A different paid question with enough characters.",
          "0x1111111111111111111111111111111111111111",
        ),
      ).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.CIRCLE_PAYER_ADDRESS;
      else process.env.CIRCLE_PAYER_ADDRESS = previous;
    }
  });
});
