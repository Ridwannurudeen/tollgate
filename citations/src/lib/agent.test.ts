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

  it("allocates by grounding-per-USDC, dropping a costlier lower-value source", async () => {
    const completeChat = async (
      messages: { role: "system" | "user"; content: string }[],
    ) => {
      const stage = stageOf(messages);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            // Most relevant but most expensive (worst value) — should be dropped.
            {
              sourceId: "circle-gateway-nano",
              verdict: "buy",
              relevance: 95,
              reason: "x",
            },
            {
              sourceId: "arc-finality-usdc",
              verdict: "buy",
              relevance: 90,
              reason: "x",
            },
            {
              sourceId: "creator-citation-economics",
              verdict: "buy",
              relevance: 75,
              reason: "x",
            },
            // Least relevant but cheapest (best value) — should be bought.
            {
              sourceId: "rsshub-distribution",
              verdict: "buy",
              relevance: 70,
              reason: "x",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Open feed distribution, citation economics, and Arc finality together explain the paid-citation flow.",
          claims: [
            {
              text: "Open feeds distribute the cited work.",
              sourceId: "rsshub-distribution",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer:
            "Open feed distribution, citation economics, and Arc finality together explain the paid-citation flow.",
          verdict: "Grounded in the purchased sources.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await createAgentQueryRecord(
      "Which distribution and finality sources give the best value?",
      "2026-06-25T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat },
    );

    const ids = query.citations.map((citation) => citation.sourceId).sort();
    expect(ids).toEqual([
      "arc-finality-usdc",
      "creator-citation-economics",
      "rsshub-distribution",
    ]);
    expect(ids).not.toContain("circle-gateway-nano");
    expect(query.totalAtomicUsdc).toBe(4_300);
  });

  it("marks bought-but-unused sources for refund before payout", async () => {
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
              reason: "Primary support.",
            },
            {
              sourceId: "arc-finality-usdc",
              verdict: "buy",
              relevance: 80,
              reason: "Bought but not ultimately used.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bind budgets while Arc context is not needed in the final claim.",
          claims: [
            {
              text: "Forum mandates bind budgets.",
              sourceId: "forum-mandates",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer:
            "Forum mandates bind budgets and publish receipts for cited source purchases.",
          verdict: "Only forum-mandates is cited in the final answer.",
          sourceUsage: [
            { sourceId: "forum-mandates", used: true },
            { sourceId: "arc-finality-usdc", used: false },
          ],
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await createAgentQueryRecord(
      "How do Forum mandates bind paid citation budgets?",
      "2026-06-25T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat },
    );

    expect(query.refundSummary).toEqual({
      boughtCount: 2,
      citedCount: 1,
      refundedCount: 1,
      refundedAtomicUsdc: 2_200,
    });
    expect(
      query.citations.find(
        (citation) => citation.sourceId === "arc-finality-usdc",
      )?.payoutPolicy,
    ).toBe("refund-unused");
  });

  it("treats sources omitted from sourceUsage as used and never refunds them", async () => {
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
              reason: "Primary support.",
            },
            {
              sourceId: "arc-finality-usdc",
              verdict: "buy",
              relevance: 80,
              reason: "Also cited in the final answer.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bind budgets and Arc finality settles the citation payments.",
          claims: [
            {
              text: "Forum mandates bind budgets.",
              sourceId: "forum-mandates",
            },
            {
              text: "Arc finality settles citation payments.",
              sourceId: "arc-finality-usdc",
            },
          ],
        });
      }
      if (stage === "critique") {
        // Forgetful model: lists only one source and omits the other.
        // Omission must mean "used" — the omitted creator still gets paid.
        return JSON.stringify({
          groundedAnswer:
            "Forum mandates bind budgets and Arc finality settles the citation payments on-chain.",
          verdict: "Both purchased sources ground the final answer.",
          sourceUsage: [{ sourceId: "forum-mandates", used: true }],
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await createAgentQueryRecord(
      "How do Forum mandates and Arc finality settle paid citations?",
      "2026-06-25T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat },
    );

    expect(query.refundSummary).toEqual({
      boughtCount: 2,
      citedCount: 2,
      refundedCount: 0,
      refundedAtomicUsdc: 0,
    });
    expect(
      query.citations.every(
        (citation) => citation.payoutPolicy !== "refund-unused",
      ),
    ).toBe(true);
  });
});
