import { describe, expect, it } from "vitest";
import {
  AgentPlanningError,
  createAgentQueryRecord,
  type ChatMessage,
} from "./agent";
import { DEFAULT_CREATOR_SOURCES } from "./catalog";
import { NO_SOURCE_ANSWER } from "./engine";
import {
  EscalationPaidError,
  type ExternalProvider,
} from "./external-providers";
import { REPAIR_PROMPT } from "./json-parse";
import type { CreatorSource } from "./types";

const LLM_CONFIG = {
  baseUrl: "https://example.com/v1",
  apiKey: "test",
  model: "test-model",
};

const FAKE_EXTERNAL_PROVIDER: ExternalProvider = {
  id: "citepay",
  label: "CitePay",
  endpoint: "https://citepay.test/api/ask",
  recipient: "0x5389688243328c26a92b301faEEAb5fbf9AFf105",
  priceAtomicUsdc: 1_000,
  ask: async () => ({
    answer:
      "CitePay says external paid agents should disclose the paid transaction, source decision, and limits of the answer.",
    assist: {
      provider: "citepay",
      endpoint: "https://citepay.test/api/ask",
      amountAtomicUsdc: 1_000,
      transaction: `0x${"d".repeat(64)}`,
      answerHash: `0x${"e".repeat(64)}`,
      queryId: "external-query-1",
      queryHash: `0x${"f".repeat(64)}`,
    },
  }),
};

function withEscalationEnv<T>(
  value: string | undefined,
  cap: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const previousEnabled = process.env.LEPTONWEB_ESCALATION;
  const previousCap = process.env.LEPTONWEB_ESCALATION_CAP_ATOMIC;
  if (value === undefined) {
    delete process.env.LEPTONWEB_ESCALATION;
  } else {
    process.env.LEPTONWEB_ESCALATION = value;
  }
  if (cap === undefined) {
    delete process.env.LEPTONWEB_ESCALATION_CAP_ATOMIC;
  } else {
    process.env.LEPTONWEB_ESCALATION_CAP_ATOMIC = cap;
  }
  return run().finally(() => {
    if (previousEnabled === undefined) {
      delete process.env.LEPTONWEB_ESCALATION;
    } else {
      process.env.LEPTONWEB_ESCALATION = previousEnabled;
    }
    if (previousCap === undefined) {
      delete process.env.LEPTONWEB_ESCALATION_CAP_ATOMIC;
    } else {
      process.env.LEPTONWEB_ESCALATION_CAP_ATOMIC = previousCap;
    }
  });
}

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
  it("rejects judge-strict mode when no LLM planner is configured", async () => {
    await expect(
      createAgentQueryRecord(
        "How does Forum bind agent spending?",
        "2026-07-11T00:00:00.000Z",
        DEFAULT_CREATOR_SOURCES,
        undefined,
        { llmConfig: null, strictMode: true },
      ),
    ).rejects.toThrow("Judge-strict mode requires a configured LLM planner.");
  });

  it("rethrows a judge-strict planner error with the failed stage", async () => {
    const plannerError = new Error("upstream planner unavailable");
    const completeChat = async () => {
      throw plannerError;
    };

    const result = createAgentQueryRecord(
      "How does Forum bind agent spending?",
      "2026-07-11T00:01:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat, strictMode: true },
    );

    await expect(result).rejects.toBeInstanceOf(AgentPlanningError);
    await expect(result).rejects.toThrow(
      "Judge-strict mode failed during appraise: upstream planner unavailable",
    );
  });

  it("repairs one malformed appraisal response and then succeeds", async () => {
    const calls: ChatMessage[][] = [];
    const completeChat = async (messages: ChatMessage[]) => {
      calls.push(messages);
      if (calls.length === 1) return "not json";
      return JSON.stringify({
        appraisals: [
          {
            sourceId: "forum-mandates",
            verdict: "skip",
            relevance: 0,
            reason: "Not relevant to this test question.",
          },
        ],
      });
    };

    const query = await createAgentQueryRecord(
      "What source should this repair test buy?",
      "2026-07-12T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat, strictMode: true },
    );

    expect(query.agentMode).toBe("llm");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.slice(-2)).toEqual([
      { role: "assistant", content: "not json" },
      { role: "user", content: REPAIR_PROMPT },
    ]);
  });

  it("fails after one repair attempt when both appraisal responses are malformed", async () => {
    const calls: ChatMessage[][] = [];
    const completeChat = async (messages: ChatMessage[]) => {
      calls.push(messages);
      return calls.length === 1 ? "not json" : "still not json";
    };

    await expect(
      createAgentQueryRecord(
        "What source should this bounded repair test buy?",
        "2026-07-12T00:01:00.000Z",
        DEFAULT_CREATOR_SOURCES,
        undefined,
        { llmConfig: LLM_CONFIG, completeChat, strictMode: true },
      ),
    ).rejects.toThrow("Judge-strict mode failed during appraise");
    expect(calls).toHaveLength(2);
  });

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

  it("keeps the deterministic fallback honest when no source is relevant", async () => {
    const sources: CreatorSource[] = [
      {
        id: "forum-receipts-test",
        title: "Forum Receipts",
        creator: "Forum Labs",
        handle: "@forum",
        wallet: "0x1111111111111111111111111111111111111111",
        url: "https://example.com/forum",
        summary: "Agent payment receipts and citation budgets.",
        tags: ["agents", "payments"],
        priceAtomicUsdc: 1_500,
        sourceKind: "internal-test",
        creatorKind: "internal-test",
        verifiedCreator: true,
      },
    ];

    const query = await createAgentQueryRecord(
      "What is the best recipe for chocolate chip cookies?",
      "2026-07-05T00:00:00.000Z",
      sources,
      undefined,
      { llmConfig: null },
    );

    expect(query.agentMode).toBe("deterministic");
    expect(query.answer).toBe(NO_SOURCE_ANSWER);
    expect(query.citations).toEqual([]);
    expect(query.totalAtomicUsdc).toBe(0);
    expect(query.agentRationale).toContain("found no registered source");
  });

  it("runs the appraise/allocate/draft/critique loop when all claims are grounded", async () => {
    const completeChat = async (
      messages: ChatMessage[],
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
    expect(query.agentModel).toBe(LLM_CONFIG.model);
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

  it("returns an honest no-source record when the LLM buys nothing", async () => {
    const stages: string[] = [];
    const completeChat = async (
      messages: ChatMessage[],
    ) => {
      const stage = stageOf(messages);
      stages.push(stage);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "skip",
              relevance: 0,
              reason: "Does not cover baking recipes.",
            },
            {
              sourceId: "arc-finality-usdc",
              verdict: "skip",
              relevance: 0,
              reason: "Does not cover baking recipes.",
            },
          ],
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await createAgentQueryRecord(
      "What is the best recipe for chocolate chip cookies?",
      "2026-07-05T00:00:00.000Z",
      DEFAULT_CREATOR_SOURCES,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat },
    );

    expect(stages).toEqual(["appraise"]);
    expect(query.agentMode).toBe("llm");
    expect(query.answer).toBe(NO_SOURCE_ANSWER);
    expect(query.citations).toEqual([]);
    expect(query.receiptHashes).toEqual([]);
    expect(query.totalAtomicUsdc).toBe(0);
    expect(query.agentBudget).toMatchObject({
      spentAtomicUsdc: 0,
      remainingAtomicUsdc: 6_500,
      purchasedCount: 0,
    });
    expect(query.sourceDecisions?.every((decision) => !decision.selected)).toBe(
      true,
    );
    expect(query.agentSteps?.map((step) => step.name)).toEqual([
      "appraise",
      "allocate",
    ]);
    expect(query.agentRationale).toContain("bought nothing");
    expect(query.refundSummary).toEqual({
      boughtCount: 0,
      citedCount: 0,
      refundedCount: 0,
      refundedAtomicUsdc: 0,
    });
  });

  it("keeps only grounded claims when an unsupported claim cannot be bought", async () => {
    const completeChat = async (
      messages: ChatMessage[],
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

  it("escalates to a paid external provider when gated on and unsupported claims remain", async () => {
    const stages: string[] = [];
    const completeChat = async (
      messages: ChatMessage[],
    ) => {
      const stage = stageOf(messages);
      stages.push(stage);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "buy",
              relevance: 88,
              reason: "Covers registry spending controls.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bound the budget, and an external market has separate spending controls.",
          claims: [
            {
              text: "Forum mandates bound the agent budget.",
              sourceId: "forum-mandates",
            },
            {
              text: "An external market has separate spending controls.",
              sourceId: "off-registry-source",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer: "Forum mandates bound the local agent budget.",
          verdict: "One off-registry claim remains unsupported.",
        });
      }
      if (stage === "escalate") {
        return JSON.stringify({
          groundedAnswer:
            "Forum mandates bound the local agent budget. Paid external assist from CitePay adds that external paid agents should disclose the transaction, source decision, and limits.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await withEscalationEnv("1", "1500", () =>
      createAgentQueryRecord(
        "How should paid agents disclose citation spending?",
        "2026-07-03T00:00:00.000Z",
        DEFAULT_CREATOR_SOURCES,
        undefined,
        {
          llmConfig: LLM_CONFIG,
          completeChat,
          externalProvider: FAKE_EXTERNAL_PROVIDER,
        },
      ),
    );

    expect(stages).toContain("escalate");
    expect(query.agentSteps?.map((step) => step.name)).toContain("escalate");
    expect(query.externalAssists?.[0]).toMatchObject({
      provider: "citepay",
      endpoint: "https://citepay.test/api/ask",
      amountAtomicUsdc: 1_000,
      queryId: "external-query-1",
    });
    expect(query.answer).toContain("Paid external assist from CitePay");
    expect(query.refundSummary?.refundedCount).toBe(0);
  });

  it("records the paid assist when the provider fails after the transfer", async () => {
    const paidButBroken: ExternalProvider = {
      ...FAKE_EXTERNAL_PROVIDER,
      ask: async () => {
        throw new EscalationPaidError(
          "CitePay escalation paid but got HTTP 500.",
          {
            provider: "citepay",
            endpoint: "https://citepay.test/api/ask",
            amountAtomicUsdc: 1_000,
            transaction: `0x${"d".repeat(64)}`,
            answerHash: `0x${"0".repeat(64)}`,
          },
        );
      },
    };
    const completeChat = async (
      messages: ChatMessage[],
    ) => {
      const stage = stageOf(messages);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "buy",
              relevance: 88,
              reason: "Covers the budget question.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bound the budget, and a missing source supports the second claim.",
          claims: [
            {
              text: "Forum mandates bound the agent budget.",
              sourceId: "forum-mandates",
            },
            {
              text: "A missing source supports the second claim.",
              sourceId: "off-registry-source",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer:
            "Forum mandates bound the agent budget and publish receipts for every cited purchase.",
          verdict: "Dropped the claim without a purchased source.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await withEscalationEnv("1", undefined, () =>
      createAgentQueryRecord(
        "How do Forum mandates bound paid agent budgets?",
        "2026-07-03T00:00:00.000Z",
        DEFAULT_CREATOR_SOURCES,
        undefined,
        {
          llmConfig: LLM_CONFIG,
          completeChat,
          externalProvider: paidButBroken,
        },
      ),
    );

    // The spend must be recorded even though the provider never answered —
    // and the record must NOT collapse to the deterministic fallback.
    expect(query.agentMode).toBe("llm");
    expect(query.externalAssists?.[0]).toMatchObject({
      provider: "citepay",
      amountAtomicUsdc: 1_000,
    });
    const escalateStep = query.agentSteps?.find(
      (step) => step.name === "escalate",
    );
    expect(escalateStep?.summary).toContain("did not answer");
    expect(escalateStep?.spentAtomicUsdc).toBe(1_000);
    expect(query.answer).toContain("Forum mandates bound the agent budget");
  });

  it("does not escalate by default when the env gate is off", async () => {
    const stages: string[] = [];
    const completeChat = async (
      messages: ChatMessage[],
    ) => {
      const stage = stageOf(messages);
      stages.push(stage);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "buy",
              relevance: 88,
              reason: "Covers registry spending controls.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bound the budget, and a missing source supports the second claim.",
          claims: [
            {
              text: "Forum mandates bound the agent budget.",
              sourceId: "forum-mandates",
            },
            {
              text: "A missing source supports the second claim.",
              sourceId: "off-registry-source",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer: "Forum mandates bound the local agent budget.",
          verdict: "One off-registry claim remains unsupported.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await withEscalationEnv(undefined, undefined, () =>
      createAgentQueryRecord(
        "How should paid agents disclose citation spending?",
        "2026-07-03T00:00:00.000Z",
        DEFAULT_CREATOR_SOURCES,
        undefined,
        {
          llmConfig: LLM_CONFIG,
          completeChat,
          externalProvider: FAKE_EXTERNAL_PROVIDER,
        },
      ),
    );

    expect(stages).not.toContain("escalate");
    expect(query.agentSteps?.map((step) => step.name)).not.toContain(
      "escalate",
    );
    expect(query.externalAssists).toBeUndefined();
  });

  it("does not escalate when there are no unsupported claims", async () => {
    const stages: string[] = [];
    const completeChat = async (
      messages: ChatMessage[],
    ) => {
      const stage = stageOf(messages);
      stages.push(stage);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "buy",
              relevance: 88,
              reason: "Covers registry spending controls.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bound the local agent budget and receipts disclose paid citation spending.",
          claims: [
            {
              text: "Forum mandates bound the local agent budget.",
              sourceId: "forum-mandates",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer:
            "Forum mandates bound the local agent budget and receipts disclose paid citation spending.",
          verdict: "All claims are grounded.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await withEscalationEnv("1", "1500", () =>
      createAgentQueryRecord(
        "How should paid agents disclose citation spending?",
        "2026-07-03T00:00:00.000Z",
        DEFAULT_CREATOR_SOURCES,
        undefined,
        {
          llmConfig: LLM_CONFIG,
          completeChat,
          externalProvider: FAKE_EXTERNAL_PROVIDER,
        },
      ),
    );

    expect(stages).not.toContain("escalate");
    expect(query.agentSteps?.map((step) => step.name)).not.toContain(
      "escalate",
    );
    expect(query.externalAssists).toBeUndefined();
  });

  it("does not escalate when the cap is below the provider price", async () => {
    const stages: string[] = [];
    const completeChat = async (
      messages: ChatMessage[],
    ) => {
      const stage = stageOf(messages);
      stages.push(stage);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: [
            {
              sourceId: "forum-mandates",
              verdict: "buy",
              relevance: 88,
              reason: "Covers registry spending controls.",
            },
          ],
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "Forum mandates bound the budget, and a missing source supports the second claim.",
          claims: [
            {
              text: "Forum mandates bound the agent budget.",
              sourceId: "forum-mandates",
            },
            {
              text: "A missing source supports the second claim.",
              sourceId: "off-registry-source",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer: "Forum mandates bound the local agent budget.",
          verdict: "One off-registry claim remains unsupported.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await withEscalationEnv("1", "999", () =>
      createAgentQueryRecord(
        "How should paid agents disclose citation spending?",
        "2026-07-03T00:00:00.000Z",
        DEFAULT_CREATOR_SOURCES,
        undefined,
        {
          llmConfig: LLM_CONFIG,
          completeChat,
          externalProvider: FAKE_EXTERNAL_PROVIDER,
        },
      ),
    );

    expect(stages).not.toContain("escalate");
    expect(query.agentSteps?.map((step) => step.name)).not.toContain(
      "escalate",
    );
    expect(query.externalAssists).toBeUndefined();
  });

  it("reflects by buying one more source to ground an unsupported claim", async () => {
    let draftCalls = 0;
    const completeChat = async (
      messages: ChatMessage[],
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
      messages: ChatMessage[],
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

  it("allocates by learned grounding yield when appraisals are tied", async () => {
    const sources: CreatorSource[] = [
      {
        id: "low-yield-agent-payments",
        title: "Low Yield Agent Payments",
        creator: "Low Yield Lab",
        handle: "@low",
        wallet: "0x1111111111111111111111111111111111111111",
        url: "https://example.com/low",
        summary: "AI agents pay creators with citation receipts.",
        tags: ["agents", "creators"],
        priceAtomicUsdc: 1_000,
        sourceKind: "internal-test",
        creatorKind: "internal-test",
        verifiedCreator: false,
      },
      {
        id: "high-yield-agent-payments-a",
        title: "High Yield Agent Payments A",
        creator: "High Yield Lab A",
        handle: "@higha",
        wallet: "0x2222222222222222222222222222222222222222",
        url: "https://example.com/high-a",
        summary: "AI agents pay creators with citation receipts.",
        tags: ["agents", "creators"],
        priceAtomicUsdc: 1_000,
        sourceKind: "internal-test",
        creatorKind: "internal-test",
        verifiedCreator: false,
      },
      {
        id: "high-yield-agent-payments-b",
        title: "High Yield Agent Payments B",
        creator: "High Yield Lab B",
        handle: "@highb",
        wallet: "0x3333333333333333333333333333333333333333",
        url: "https://example.com/high-b",
        summary: "AI agents pay creators with citation receipts.",
        tags: ["agents", "creators"],
        priceAtomicUsdc: 1_000,
        sourceKind: "internal-test",
        creatorKind: "internal-test",
        verifiedCreator: false,
      },
      {
        id: "high-yield-agent-payments-c",
        title: "High Yield Agent Payments C",
        creator: "High Yield Lab C",
        handle: "@highc",
        wallet: "0x4444444444444444444444444444444444444444",
        url: "https://example.com/high-c",
        summary: "AI agents pay creators with citation receipts.",
        tags: ["agents", "creators"],
        priceAtomicUsdc: 1_000,
        sourceKind: "internal-test",
        creatorKind: "internal-test",
        verifiedCreator: false,
      },
    ];
    const groundingYields = new Map(
      sources.map((source) => [
        source.id,
        {
          sourceId: source.id,
          used: source.id.startsWith("high-yield") ? 8 : 1,
          bought: 10,
          value: source.id.startsWith("high-yield") ? 0.75 : 1 / 6,
        },
      ]),
    );
    const completeChat = async (
      messages: ChatMessage[],
    ) => {
      const stage = stageOf(messages);
      if (stage === "appraise") {
        return JSON.stringify({
          appraisals: sources.map((source) => ({
            sourceId: source.id,
            verdict: "buy",
            relevance: 80,
            reason: "Tied relevance and price.",
          })),
        });
      }
      if (stage === "draft") {
        return JSON.stringify({
          answer:
            "High-yield sources explain how AI agents pay creators with citation receipts.",
          claims: [
            {
              text: "AI agents pay creators with citation receipts.",
              sourceId: "high-yield-agent-payments-a",
            },
          ],
        });
      }
      if (stage === "critique") {
        return JSON.stringify({
          groundedAnswer:
            "High-yield sources explain how AI agents pay creators with citation receipts.",
          verdict: "Grounded in the purchased sources.",
        });
      }
      throw new Error(`unexpected stage ${stage}`);
    };

    const query = await createAgentQueryRecord(
      "How should AI agents pay creators?",
      "2026-07-03T00:00:00.000Z",
      sources,
      undefined,
      { llmConfig: LLM_CONFIG, completeChat, groundingYields },
    );

    const ids = query.citations.map((citation) => citation.sourceId).sort();
    expect(ids).toEqual([
      "high-yield-agent-payments-a",
      "high-yield-agent-payments-b",
      "high-yield-agent-payments-c",
    ]);
    expect(ids).not.toContain("low-yield-agent-payments");
  });

  it("marks bought-but-unused sources for refund before payout", async () => {
    const completeChat = async (
      messages: ChatMessage[],
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
      messages: ChatMessage[],
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
