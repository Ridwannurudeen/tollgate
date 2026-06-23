import { describe, expect, it } from "vitest";
import { DEFAULT_CREATOR_SOURCES } from "./catalog";
import { createAgentQueryRecord } from "./agent";

describe("createAgentQueryRecord", () => {
  it("falls back to the deterministic policy without an LLM config", async () => {
    const query = await createAgentQueryRecord(
      "How does Forum bound agent spending for paid citations?",
      "2026-06-23T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: null },
    );

    expect(query.agentMode).toBe("deterministic");
    expect(query.citations.length).toBeGreaterThan(0);
    expect(query.agentBudget?.spentAtomicUsdc).toBe(query.totalAtomicUsdc);
  });

  it("uses an affordable LLM source plan when configured", async () => {
    const query = await createAgentQueryRecord(
      "How does Forum publish receipts for agent spending?",
      "2026-06-23T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      {
        llmConfig: {
          baseUrl: "https://example.com/v1",
          apiKey: "test",
          model: "test-model",
        },
        completeChat: async () =>
          JSON.stringify({
            answer:
              "Forum-style mandates bind an agent budget, publish receipts for every source purchase, and make citation spending visible instead of advisory.",
            buys: [
              {
                sourceId: "forum-mandates",
                reason:
                  "Forum is the source that explains mandates and receipts.",
              },
            ],
            skips: [
              {
                sourceId: "circle-gateway-nano",
                reason:
                  "Gateway settlement is useful later, but the question is about Forum receipts.",
              },
            ],
            rationale:
              "Buy the Forum mandate source because it directly answers the receipt-control question.",
          }),
      },
    );

    expect(query.agentMode).toBe("llm");
    expect(query.citations).toHaveLength(1);
    expect(query.citations[0].sourceId).toBe("forum-mandates");
    expect(query.agentBudget?.spentAtomicUsdc).toBe(1_500);
  });
});
