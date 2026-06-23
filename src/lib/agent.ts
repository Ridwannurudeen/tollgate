import {
  createQueryRecord,
  DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  planCitationMarket,
} from "./engine";
import { sha256Hex } from "./hash";
import type {
  AgentBudget,
  Citation,
  CreatorSource,
  QueryPaymentEvidence,
  QueryRecord,
  SourceDecision,
} from "./types";

const MAX_AGENT_SOURCES = 3;
const MAX_ANSWER_LENGTH = 1_600;
const MAX_REASON_LENGTH = 220;

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type AgentOptions = {
  llmConfig?: LlmConfig | null;
  completeChat?: (
    messages: ChatMessage[],
    config: LlmConfig,
  ) => Promise<string>;
};

type ModelSourceChoice = {
  sourceId: string;
  reason: string;
};

type ModelPlan = {
  answer: string;
  buys: ModelSourceChoice[];
  skips: ModelSourceChoice[];
  rationale: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function cleanModelText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function llmConfigFromEnv(): LlmConfig | null {
  const apiKey =
    process.env.LEPTONWEB_LLM_API_KEY ?? process.env.OPENAI_API_KEY;
  const model = process.env.LEPTONWEB_LLM_MODEL;
  if (!apiKey || !model) return null;
  return {
    apiKey,
    model,
    baseUrl: process.env.LEPTONWEB_LLM_BASE_URL ?? "https://api.openai.com/v1",
  };
}

function sourceSnapshot(source: CreatorSource) {
  return {
    id: source.id,
    title: source.title,
    creator: source.creator,
    url: source.url,
    summary: source.summary,
    tags: source.tags,
    priceAtomicUsdc: source.priceAtomicUsdc,
  };
}

function buildMessages(
  question: string,
  sources: CreatorSource[],
  sourceBudgetAtomicUsdc: number,
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are Tollgate, an autonomous source-buying answer agent. Buy only useful sources, stay inside budget, ground the answer only in bought source summaries, and return strict JSON with answer, buys, skips, and rationale.",
    },
    {
      role: "user",
      content: JSON.stringify({
        question,
        sourceBudgetAtomicUsdc,
        maxSources: MAX_AGENT_SOURCES,
        candidateSources: sources.map(sourceSnapshot),
        responseShape: {
          answer: "string",
          buys: [{ sourceId: "string", reason: "string" }],
          skips: [{ sourceId: "string", reason: "string" }],
          rationale: "string",
        },
      }),
    },
  ];
}

async function completeOpenAiCompatibleChat(
  messages: ChatMessage[],
  config: LlmConfig,
): Promise<string> {
  const response = await fetch(
    `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: 2000,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`LLM planner failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new Error("LLM planner returned an invalid response.");
  }
  const choice = payload.choices[0] as unknown;
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new Error("LLM planner returned no message.");
  }
  const content = choice.message.content;
  if (typeof content !== "string") {
    throw new Error("LLM planner message was not text.");
  }
  return content;
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("LLM planner did not return JSON.");
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

function parseChoices(value: unknown): ModelSourceChoice[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const sourceId = cleanModelText(item.sourceId, 80);
      const reason = cleanModelText(item.reason, MAX_REASON_LENGTH);
      if (!sourceId || !reason) return null;
      return { sourceId, reason };
    })
    .filter((item): item is ModelSourceChoice => item !== null);
}

function parseModelPlan(text: string): ModelPlan {
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed)) {
    throw new Error("LLM planner JSON must be an object.");
  }
  const answer = cleanModelText(parsed.answer, MAX_ANSWER_LENGTH);
  const rationale = cleanModelText(parsed.rationale, MAX_REASON_LENGTH);
  if (answer.length < 40) {
    throw new Error("LLM planner answer was too short.");
  }
  return {
    answer,
    rationale,
    buys: parseChoices(parsed.buys),
    skips: parseChoices(parsed.skips),
  };
}

function enforceModelBuys(
  plan: ModelPlan,
  sources: CreatorSource[],
  sourceBudgetAtomicUsdc: number,
): CreatorSource[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const selectedSources: CreatorSource[] = [];
  const seen = new Set<string>();
  let remainingAtomicUsdc = sourceBudgetAtomicUsdc;

  for (const buy of plan.buys) {
    if (selectedSources.length >= MAX_AGENT_SOURCES) break;
    if (seen.has(buy.sourceId)) continue;
    const source = sourceById.get(buy.sourceId);
    if (!source) continue;
    if (source.priceAtomicUsdc > remainingAtomicUsdc) continue;
    seen.add(source.id);
    selectedSources.push(source);
    remainingAtomicUsdc -= source.priceAtomicUsdc;
  }

  return selectedSources;
}

function reasonBySourceId(choices: ModelSourceChoice[]): Map<string, string> {
  return new Map(choices.map((choice) => [choice.sourceId, choice.reason]));
}

function buildLlmQueryRecord(
  question: string,
  createdAt: string,
  sources: CreatorSource[],
  modelPlan: ModelPlan,
  readerPayment: QueryPaymentEvidence | undefined,
): QueryRecord {
  const citationMarket = planCitationMarket(
    question,
    sources,
    MAX_AGENT_SOURCES,
    DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  );
  const selectedSources = enforceModelBuys(
    modelPlan,
    sources,
    DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  );
  if (selectedSources.length === 0) {
    throw new Error("LLM planner did not buy any affordable known source.");
  }

  const selectedIds = new Set(selectedSources.map((source) => source.id));
  const buyReasons = reasonBySourceId(modelPlan.buys);
  const skipReasons = reasonBySourceId(modelPlan.skips);
  const decisions: SourceDecision[] = citationMarket.decisions.map(
    (decision) => {
      const selected = selectedIds.has(decision.sourceId);
      const modelReason = selected
        ? buyReasons.get(decision.sourceId)
        : skipReasons.get(decision.sourceId);
      return {
        ...decision,
        selected,
        reason: modelReason ?? decision.reason,
      };
    },
  );
  const spentAtomicUsdc = selectedSources.reduce(
    (sum, source) => sum + source.priceAtomicUsdc,
    0,
  );
  const budget: AgentBudget = {
    sourceBudgetAtomicUsdc: DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
    spentAtomicUsdc,
    remainingAtomicUsdc: DEFAULT_SOURCE_BUDGET_ATOMIC_USDC - spentAtomicUsdc,
    candidateCount: citationMarket.budget.candidateCount,
    purchasedCount: selectedSources.length,
  };
  const citations: Citation[] = selectedSources.map((source) => ({
    sourceId: source.id,
    title: source.title,
    creator: source.creator,
    handle: source.handle,
    wallet: source.wallet,
    url: source.url,
    amountAtomicUsdc: source.priceAtomicUsdc,
    reason:
      buyReasons.get(source.id) ??
      "The LLM planner selected this source under the source budget.",
  }));
  const queryHash = sha256Hex({
    question,
    citations,
    sourceDecisions: decisions,
    agentBudget: budget,
    readerPaymentHash: readerPayment?.paymentHash,
  });
  const answerHash = sha256Hex({
    answer: modelPlan.answer,
    citations,
    sourceDecisions: decisions,
    agentBudget: budget,
    readerPaymentHash: readerPayment?.paymentHash,
  });
  const id = sha256Hex({ createdAt, question, queryHash }).slice(0, 18);

  return {
    id,
    question,
    answer: modelPlan.answer,
    queryHash,
    answerHash,
    totalAtomicUsdc: spentAtomicUsdc,
    citations,
    agentMode: "llm",
    agentRationale:
      modelPlan.rationale ||
      "The LLM planner selected the source bundle under budget.",
    sourceDecisions: decisions,
    agentBudget: budget,
    receiptHashes: [],
    readerPayment,
    createdAt,
  };
}

function deterministicFallback(
  question: string,
  createdAt: string,
  sources: CreatorSource[],
  readerPayment: QueryPaymentEvidence | undefined,
  reason: string,
): QueryRecord {
  return {
    ...createQueryRecord(question, createdAt, sources, readerPayment),
    agentMode: "deterministic",
    agentRationale: reason,
  };
}

export async function createAgentQueryRecord(
  question: string,
  createdAt: string,
  sources: CreatorSource[],
  readerPayment?: QueryPaymentEvidence,
  options: AgentOptions = {},
): Promise<QueryRecord> {
  const llmConfig =
    options.llmConfig === undefined ? llmConfigFromEnv() : options.llmConfig;
  if (!llmConfig) {
    return deterministicFallback(
      question,
      createdAt,
      sources,
      readerPayment,
      "No LLM planner is configured; deterministic budget policy selected the citations.",
    );
  }

  try {
    const completeChat = options.completeChat ?? completeOpenAiCompatibleChat;
    const text = await completeChat(
      buildMessages(question, sources, DEFAULT_SOURCE_BUDGET_ATOMIC_USDC),
      llmConfig,
    );
    return buildLlmQueryRecord(
      question,
      createdAt,
      sources,
      parseModelPlan(text),
      readerPayment,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "LLM planner failed.";
    return deterministicFallback(
      question,
      createdAt,
      sources,
      readerPayment,
      `LLM planner fallback: ${message}`,
    );
  }
}
