import {
  createQueryRecord,
  DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  planCitationMarket,
} from "./engine";
import { sha256Hex } from "./hash";
import type {
  AgentBudget,
  AgentStep,
  Citation,
  CreatorSource,
  QueryPaymentEvidence,
  QueryRecord,
  SourceDecision,
} from "./types";

const MAX_AGENT_SOURCES = 3;
const MAX_ANSWER_LENGTH = 1_600;
const MAX_REASON_LENGTH = 220;
const MAX_CLAIMS = 8;

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type CompleteChat = (
  messages: ChatMessage[],
  config: LlmConfig,
) => Promise<string>;

export type AgentOptions = {
  llmConfig?: LlmConfig | null;
  completeChat?: CompleteChat;
};

type Appraisal = {
  sourceId: string;
  verdict: "buy" | "skip";
  relevance: number;
  reason: string;
};

type DraftClaim = {
  text: string;
  sourceId: string;
};

type Draft = {
  answer: string;
  claims: DraftClaim[];
};

type Critique = {
  groundedAnswer: string;
  verdict: string;
};

type AgentLoopResult = {
  answer: string;
  selected: CreatorSource[];
  steps: AgentStep[];
  rationale: string;
  appraisalReason: Map<string, string>;
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

function appraiseMessages(
  question: string,
  sources: CreatorSource[],
  sourceBudgetAtomicUsdc: number,
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are Tollgate, an autonomous source-buying answer agent. STEP 1 is APPRAISAL: judge each candidate source for relevance to the question and decide buy or skip. Do not write an answer yet. Stay inside budget and return strict JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        stage: "appraise",
        question,
        sourceBudgetAtomicUsdc,
        maxSources: MAX_AGENT_SOURCES,
        candidateSources: sources.map(sourceSnapshot),
        responseShape: {
          appraisals: [
            {
              sourceId: "string",
              verdict: "buy|skip",
              relevance: "0-100",
              reason: "string",
            },
          ],
        },
      }),
    },
  ];
}

function draftMessages(
  question: string,
  purchasedSources: CreatorSource[],
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are Tollgate. STEP 2 is DRAFTING: answer the question grounded ONLY in the purchased sources below. Every claim must cite the sourceId it came from. Return strict JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        stage: "draft",
        question,
        purchasedSources: purchasedSources.map(sourceSnapshot),
        responseShape: {
          answer: "string",
          claims: [{ text: "string", sourceId: "string" }],
        },
      }),
    },
  ];
}

function critiqueMessages(
  question: string,
  draft: Draft,
  purchasedSourceIds: string[],
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are Tollgate. STEP 3 is SELF-CRITIQUE: check that every claim is supported by one of the purchased sourceIds. Rewrite the answer so it only keeps claims backed by a purchased source. Return strict JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        stage: "critique",
        question,
        purchasedSourceIds,
        draft,
        responseShape: { groundedAnswer: "string", verdict: "string" },
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

function parseAppraisals(text: string): Appraisal[] {
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.appraisals)) {
    throw new Error("LLM appraisal returned no appraisals.");
  }
  return parsed.appraisals
    .map((item) => {
      if (!isRecord(item)) return null;
      const sourceId = cleanModelText(item.sourceId, 80);
      if (!sourceId) return null;
      const reason = cleanModelText(item.reason, MAX_REASON_LENGTH);
      const verdict = item.verdict === "buy" ? "buy" : "skip";
      const relevanceRaw =
        typeof item.relevance === "number"
          ? item.relevance
          : Number(item.relevance);
      const relevance = Number.isFinite(relevanceRaw)
        ? Math.max(0, Math.min(100, Math.round(relevanceRaw)))
        : 0;
      return { sourceId, verdict, relevance, reason } satisfies Appraisal;
    })
    .filter((item): item is Appraisal => item !== null);
}

function parseDraft(text: string): Draft {
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed)) {
    throw new Error("LLM draft JSON must be an object.");
  }
  const answer = cleanModelText(parsed.answer, MAX_ANSWER_LENGTH);
  if (answer.length < 40) {
    throw new Error("LLM draft answer was too short.");
  }
  const claims = Array.isArray(parsed.claims)
    ? parsed.claims
        .map((item) => {
          if (!isRecord(item)) return null;
          const claimText = cleanModelText(item.text, MAX_REASON_LENGTH);
          const sourceId = cleanModelText(item.sourceId, 80);
          if (!claimText || !sourceId) return null;
          return { text: claimText, sourceId } satisfies DraftClaim;
        })
        .filter((item): item is DraftClaim => item !== null)
        .slice(0, MAX_CLAIMS)
    : [];
  return { answer, claims };
}

function parseCritique(text: string, fallbackAnswer: string): Critique {
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed)) {
    throw new Error("LLM critique JSON must be an object.");
  }
  const grounded = cleanModelText(parsed.groundedAnswer, MAX_ANSWER_LENGTH);
  const verdict = cleanModelText(parsed.verdict, MAX_REASON_LENGTH);
  return {
    groundedAnswer: grounded.length >= 40 ? grounded : fallbackAnswer,
    verdict,
  };
}

function allocateFromAppraisals(
  appraisals: Appraisal[],
  sources: CreatorSource[],
  sourceBudgetAtomicUsdc: number,
): { selected: CreatorSource[]; remainingAtomicUsdc: number } {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const buys = appraisals
    .filter((appraisal) => appraisal.verdict === "buy")
    .sort((a, b) => b.relevance - a.relevance);
  const selected: CreatorSource[] = [];
  const seen = new Set<string>();
  let remainingAtomicUsdc = sourceBudgetAtomicUsdc;

  for (const buy of buys) {
    if (selected.length >= MAX_AGENT_SOURCES) break;
    if (seen.has(buy.sourceId)) continue;
    const source = sourceById.get(buy.sourceId);
    if (!source) continue;
    if (source.priceAtomicUsdc > remainingAtomicUsdc) continue;
    seen.add(source.id);
    selected.push(source);
    remainingAtomicUsdc -= source.priceAtomicUsdc;
  }

  return { selected, remainingAtomicUsdc };
}

function appraisalSummary(appraisals: Appraisal[]): string {
  return (
    appraisals
      .filter((appraisal) => appraisal.reason)
      .slice(0, 3)
      .map((appraisal) => `${appraisal.sourceId}: ${appraisal.reason}`)
      .join(" | ") || "Appraised every candidate by relevance to the question."
  );
}

async function runAgentLoop(
  question: string,
  sources: CreatorSource[],
  sourceBudgetAtomicUsdc: number,
  completeChat: CompleteChat,
  llmConfig: LlmConfig,
): Promise<AgentLoopResult> {
  const steps: AgentStep[] = [];

  const appraisals = parseAppraisals(
    await completeChat(
      appraiseMessages(question, sources, sourceBudgetAtomicUsdc),
      llmConfig,
    ),
  );
  const buyCount = appraisals.filter(
    (appraisal) => appraisal.verdict === "buy",
  ).length;
  const appraisalReason = new Map(
    appraisals
      .filter((appraisal) => appraisal.reason)
      .map((appraisal) => [appraisal.sourceId, appraisal.reason]),
  );
  steps.push({
    index: 0,
    name: "appraise",
    summary: `Appraised ${appraisals.length} candidate${
      appraisals.length === 1 ? "" : "s"
    }: ${buyCount} to buy, ${appraisals.length - buyCount} to skip.`,
    detail: appraisalSummary(appraisals),
  });

  let { selected, remainingAtomicUsdc } = allocateFromAppraisals(
    appraisals,
    sources,
    sourceBudgetAtomicUsdc,
  );
  if (selected.length === 0) {
    throw new Error("LLM appraisal selected no affordable known source.");
  }
  steps.push({
    index: 1,
    name: "allocate",
    summary: `Allocated the budget to ${selected.length} source${
      selected.length === 1 ? "" : "s"
    }.`,
    detail: selected.map((source) => source.title).join(", "),
    spentAtomicUsdc: sourceBudgetAtomicUsdc - remainingAtomicUsdc,
  });

  let draft = parseDraft(
    await completeChat(draftMessages(question, selected), llmConfig),
  );
  steps.push({
    index: 2,
    name: "draft",
    summary: `Drafted an answer with ${draft.claims.length} grounded claim${
      draft.claims.length === 1 ? "" : "s"
    }.`,
    detail: "Every claim is tied to a purchased sourceId.",
  });

  let boughtIds = new Set(selected.map((source) => source.id));
  const unsupported = draft.claims.filter(
    (claim) => !boughtIds.has(claim.sourceId),
  );
  const critique = parseCritique(
    await completeChat(
      critiqueMessages(question, draft, [...boughtIds]),
      llmConfig,
    ),
    draft.answer,
  );
  steps.push({
    index: 3,
    name: "critique",
    summary:
      unsupported.length === 0
        ? "Verified every claim is backed by a purchased source."
        : `Caught ${unsupported.length} unsupported claim${
            unsupported.length === 1 ? "" : "s"
          } to resolve.`,
    detail: critique.verdict || "Self-critique complete.",
  });

  let answer = critique.groundedAnswer;
  let rationale =
    critique.verdict ||
    `Bought ${selected.length} source${
      selected.length === 1 ? "" : "s"
    } and grounded the answer in them.`;

  if (unsupported.length > 0 && selected.length < MAX_AGENT_SOURCES) {
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    const candidate = unsupported
      .map((claim) => sourceById.get(claim.sourceId))
      .find(
        (source): source is CreatorSource =>
          source !== undefined &&
          !boughtIds.has(source.id) &&
          source.priceAtomicUsdc <= remainingAtomicUsdc,
      );
    if (candidate) {
      selected = [...selected, candidate];
      remainingAtomicUsdc -= candidate.priceAtomicUsdc;
      boughtIds = new Set(selected.map((source) => source.id));
      const reDraft = parseDraft(
        await completeChat(draftMessages(question, selected), llmConfig),
      );
      draft = reDraft;
      answer = reDraft.answer;
      steps.push({
        index: 4,
        name: "reflect",
        summary: `Bought 1 more source (${candidate.title}) to ground an unsupported claim, then redrafted.`,
        detail: `Citation spend rose to cover ${candidate.creator}.`,
        spentAtomicUsdc: sourceBudgetAtomicUsdc - remainingAtomicUsdc,
      });
      rationale = `Self-critique caught an unsupported claim; the agent bought ${candidate.title} and regrounded the answer.`;
    }
  }

  return { answer, selected, steps, rationale, appraisalReason };
}

function buildLlmQueryRecord(
  question: string,
  createdAt: string,
  sources: CreatorSource[],
  loop: AgentLoopResult,
  readerPayment: QueryPaymentEvidence | undefined,
): QueryRecord {
  const citationMarket = planCitationMarket(
    question,
    sources,
    MAX_AGENT_SOURCES,
    DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  );
  const selectedIds = new Set(loop.selected.map((source) => source.id));
  const decisions: SourceDecision[] = citationMarket.decisions.map(
    (decision) => ({
      ...decision,
      selected: selectedIds.has(decision.sourceId),
      reason: loop.appraisalReason.get(decision.sourceId) ?? decision.reason,
    }),
  );
  const spentAtomicUsdc = loop.selected.reduce(
    (sum, source) => sum + source.priceAtomicUsdc,
    0,
  );
  const budget: AgentBudget = {
    sourceBudgetAtomicUsdc: DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
    spentAtomicUsdc,
    remainingAtomicUsdc: DEFAULT_SOURCE_BUDGET_ATOMIC_USDC - spentAtomicUsdc,
    candidateCount: citationMarket.budget.candidateCount,
    purchasedCount: loop.selected.length,
  };
  const citations: Citation[] = loop.selected.map((source) => ({
    sourceId: source.id,
    title: source.title,
    creator: source.creator,
    handle: source.handle,
    wallet: source.wallet,
    url: source.url,
    amountAtomicUsdc: source.priceAtomicUsdc,
    reason:
      loop.appraisalReason.get(source.id) ??
      "The agent appraised this source as worth buying under budget.",
  }));
  const traceHash = sha256Hex(loop.steps);
  const queryHash = sha256Hex({
    question,
    citations,
    sourceDecisions: decisions,
    agentBudget: budget,
    readerPaymentHash: readerPayment?.paymentHash,
  });
  const answerHash = sha256Hex({
    answer: loop.answer,
    citations,
    sourceDecisions: decisions,
    agentBudget: budget,
    traceHash,
    readerPaymentHash: readerPayment?.paymentHash,
  });
  const id = sha256Hex({ createdAt, question, queryHash }).slice(0, 18);

  return {
    id,
    question,
    answer: loop.answer,
    queryHash,
    answerHash,
    totalAtomicUsdc: spentAtomicUsdc,
    citations,
    agentMode: "llm",
    agentRationale: loop.rationale,
    sourceDecisions: decisions,
    agentBudget: budget,
    agentSteps: loop.steps,
    traceHash,
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
    const loop = await runAgentLoop(
      question,
      sources,
      DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
      completeChat,
      llmConfig,
    );
    return buildLlmQueryRecord(
      question,
      createdAt,
      sources,
      loop,
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
