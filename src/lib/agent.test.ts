import { describe, expect, it } from "vitest";
import { createAgentQueryRecord } from "./agent";
import { DEFAULT_CREATOR_SOURCES } from "./catalog";

const LLM_CONFIG = {
  baseUrl: "https://example.com/v1",
  apiKey: "test",
  model: "test-model",
};

function stageOf(messages: { role: string; content: string }[]): string {
  const user = messages[1]?.content ?? "{}";
  try {
    const parsed = JSON.parse(user) as { stage?: string };
    return parsed.stage ?? "";
  } catch {
    return "";
  }
}

describe("createAgentQueryRecord", () => {
  it("falls back to the deterministic policy with a trace when no LLM is configured", async () => {
    const query = await createAgentQueryRecord(
      "How does Forum bound agent spending for paid citations?",
      "2026-06-25T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: null },
    );

    expect(query.agentMode).toBe("deterministic");
    expect(query.citations.length).toBeGreaterThan(0);
    expect(query.agentBudget?.spentAtomicUsdc).toBe(query.totalAtomicUsdc);
    expect(query.agentSteps?.length).toBeGreaterThan(0);
    expect(query.traceHash).toBeTruthy();
  });

  it("runs the appraise/allocate/draft/critique loop when all claims are grounded", async () => {
    const completeChat = async (
      messages: { role: "system" | "user"; content: string }[],
    ) => {
      const stage = stageOf(messages);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "buy",
              relevance: 92,
              reason: "Explains Forum mandates and receipts.",
            },
            {
              sourceId: "circle-gateway-nano",
              verdict: "skip",
              relevance: 12,
              reason: "Gateway batching is not the topic.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bind an agent budget and publish a receipt for every cited source purchase.",
          claims: [
            {
              text: "Forum publishes a receipt for every purchase.",
              sourceId: "forum-mandates",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer:
            "Forum mandates bind an agent budget and publish a receipt for every cited source purchase.",
          verdict: "Every claim is supported by forum-mandates.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await createAgentQueryRecord(
      "How does Forum publish receipts for agent spending?",
      "2026-06-25T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat },
    );

    expect(query.agentMode).toBe("llm");
    expect(query.citations).toHaveLength(1);
    expect(query.citations[0].sourceId).toBe("forum-mandates");
    expect(query.agentBudget?.spentAtomicUsdc).toBe(1_500);
    expect(query.agentSteps?.map((step) => step.name)).toEqual([
      "appraise",
      "allocate",
      "draft",
      "critique",
    ]);
    expect(query.traceHash).toBeTruthy();
  });

  it("keeps only grounded claims when an unsupported claim cannot be bought", async () => {
    const completeChat = async (
      messages: { role: "system" | "user"; content: string }[],
    ) => {
      const stage = stageOf(messages);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "buy",
              relevance: 88,
              reason: "Covers the budget mandate question.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bound the budget, though one extra claim has no purchased backing.",
          claims: [
            {
              text: "Forum mandates bound the agent budget.",
              sourceId: "forum-mandates",
            },
            {
              text: "An unrelated assertion with no source.",
              sourceId: "ghost-source",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer:
            "Forum mandates bound the agent budget and pay each cited source in USDC.",
          verdict: "Dropped one claim with no purchased source.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await createAgentQueryRecord(
      "How do Forum mandates bound agent budgets?",
      "2026-06-25T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat },
    );

    expect(query.agentMode).toBe("llm");
    expect(query.citations).toHaveLength(1);
    const stepNames = query.agentSteps?.map((step) => step.name) ?? [];
    expect(stepNames).not.toContain("reflect");
    const critique = query.agentSteps?.find((step) => step.name === "critique");
    expect(critique?.summary).toContain("unsupported");
    expect(query.answer).toContain("USDC");
  });

  it("reflects by buying one more source to ground an unsupported claim", async () => {
    let draftCalls = 0;
    const completeChat = async (
      messages: { role: "system" | "user"; content: string }[],
    ) => {
      const stage = stageOf(messages);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "buy",
              relevance: 90,
              reason: "Directly answers the receipt-control question.",
            },
            {
              sourceId: "arc-finality-usdc",
              verdict: "skip",
              relevance: 40,
              reason: "Useful context, but skipped on the first pass.",
            },
          ],
        });
      }
      if (stage === "draft") {
        draftCalls += 1;
        if (draftCalls === 1) {
          return JSON.stringify({
            answer:
              "Forum publishes receipts, and Arc finality settles the USDC payment quickly.",
            claims: [
              {
                text: "Forum publishes citation receipts.",
                sourceId: "forum-mandates",
              },
              {
                text: "Arc settles the USDC payment with fast finality.",
                sourceId: "arc-finality-usdc",
              },
            ],
          });
        }
        return JSON.stringify({
          answer:
            "Forum publishes receipts and Arc finality settles the USDC payment after the reflective re-buy.",
          claims: [
            {
              text: "Forum publishes citation receipts.",
              sourceId: "forum-mandates",
            },
            {
              text: "Arc settles the USDC payment with fast finality.",
              sourceId: "arc-finality-usdc",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer: "Forum publishes receipts for each cited source.",
          verdict: "One claim relies on a source that was not purchased.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await createAgentQueryRecord(
      "How do Forum receipts and Arc finality settle citation payments?",
      "2026-06-25T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat },
    );

    expect(query.agentMode).toBe("llm");
    expect(query.citations).toHaveLength(2);
    expect(query.citations.map((citation) => citation.sourceId).sort()).toEqual(
      ["arc-finality-usdc", "forum-mandates"],
    );
    expect(query.totalAtomicUsdc).toBe(3_700);
    expect(query.agentSteps?.map((step) => step.name)).toContain("reflect");
    expect(query.answer).toContain("reflective re-buy");
  });
});
