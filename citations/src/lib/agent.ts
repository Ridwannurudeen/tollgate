import {
  createQueryRecord,
  DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  NO_SOURCE_ANSWER,
  planCitationMarket,
} from "./engine";
import {
  EscalationPaidError,
  EXTERNAL_PROVIDERS,
  type ExternalProvider,
} from "./external-providers";
import { groundingYieldValue, type GroundingYieldMap } from "./grounding-yield";
import { sha256Hex } from "./hash";
import { completeAndParse, parseJsonObject } from "./json-parse";
import { buildSourceContent } from "./source-content";
import { x402Providers } from "./x402-buyer";
import type {
  AgentBudget,
  AgentStep,
  Citation,
  CreatorSource,
  ExternalAssist,
  QueryPaymentEvidence,
  QueryRecord,
  SourceDecision,
} from "./types";

const MAX_AGENT_SOURCES = 3;
const MAX_ANSWER_LENGTH = 1_600;
const MAX_REASON_LENGTH = 220;
const MAX_CLAIMS = 8;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
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
  externalProvider?: ExternalProvider;
  groundingYields?: GroundingYieldMap;
  strictMode?: boolean;
  serverMode?: AgentServerMode;
};

export type AgentServerMode = "offline-preview" | "production" | "judge-strict";

export type AgentStage =
  | "appraise"
  | "draft"
  | "critique"
  | "reflect"
  | "escalate";

export class AgentPlanningError extends Error {
  readonly stage: AgentStage;

  constructor(stage: AgentStage, cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : "LLM planner failed.";
    super(`Judge-strict mode failed during ${stage}: ${message}`);
    this.name = "AgentPlanningError";
    this.stage = stage;
  }
}

export function agentServerModeFromEnv(): AgentServerMode {
  const mode = process.env.LEPTONWEB_AGENT_MODE ?? "production";
  if (
    mode === "offline-preview" ||
    mode === "production" ||
    mode === "judge-strict"
  ) {
    return mode;
  }
  throw new Error(
    "LEPTONWEB_AGENT_MODE must be judge-strict, production, or offline-preview.",
  );
}

export function agentOptionsForServerMode(
  mode: AgentServerMode = agentServerModeFromEnv(),
): Pick<AgentOptions, "llmConfig" | "strictMode" | "serverMode"> {
  if (mode === "offline-preview") {
    return { llmConfig: null, serverMode: mode };
  }
  if (mode === "judge-strict") {
    return { strictMode: true, serverMode: mode };
  }
  return { serverMode: mode };
}

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
  explicitlyUnusedSourceIds: Set<string>;
};

type EscalationMerge = {
  groundedAnswer: string;
};

type AgentLoopResult = {
  answer: string;
  selected: CreatorSource[];
  unusedSourceIds: Set<string>;
  steps: AgentStep[];
  rationale: string;
  appraisalReason: Map<string, string>;
  externalAssists: ExternalAssist[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function cleanModelText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

// The critique stage is told to keep only claims a purchased source backs, and
// models comply by deleting the clause and leaving its punctuation standing —
// which reached the public answer on /ask as "…sources provided, ." Repairing
// the seam is cheaper than trusting every model to tidy up after itself, and it
// only ever removes punctuation that has no sentence left to attach to.
export function repairRedactedProse(value: string): string {
  return (
    value
      .replace(
        /[\s,;—-]*\b(?:but|and|however|although|though|while|because|so|yet)\s*\./gi,
        ".",
      )
      // A preposition orphaned by the cut survives the rule above — it is not a
      // conjunction and the comma is no longer adjacent to the full stop, which
      // is how "…every wallet, with ." reached the page. The leading comma is
      // what makes this safe to strip: prose legitimately ends "signed off on."
      // but never ", on."
      .replace(
        /,\s*\b(?:with|for|to|from|by|of|in|on|at|as|into|via|using|including|plus|per)\b\s*\./gi,
        ".",
      )
      .replace(/\s*[,;—]\s*\./g, ".")
      // A cut at the end leaves the removed sentence's stop marooned after the
      // surviving one — "…if needed. ." Collapse the pair. Requiring whitespace
      // between them keeps a deliberate ellipsis intact.
      .replace(/\.\s+\./g, ".")
      .replace(/\s+\./g, ".")
      // When the cut takes the opening clause, that sentence's own full stop is
      // left leading the answer — ". First, policy enforcement…" went out this
      // way. Strip punctuation stranded at the very start; a real answer opens
      // on a word.
      .replace(/^[\s.,;:—-]+/, "")
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

export function llmConfigFromEnv(): LlmConfig | null {
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
  const content = buildSourceContent(source, "agent-appraisal");
  return {
    id: source.id,
    title: source.title,
    creator: source.creator,
    url: source.url,
    summary: source.summary,
    previewExcerpt: content.previewExcerpt,
    sourceKind: source.sourceKind,
    verifiedCreator: source.verifiedCreator,
    creatorClaimed: source.creatorClaimed,
    tags: source.tags,
    priceAtomicUsdc: source.priceAtomicUsdc,
  };
}

function purchasedSourceSnapshot(source: CreatorSource) {
  const content = buildSourceContent(source, "agent-draft");
  return {
    id: source.id,
    title: source.title,
    creator: source.creator,
    canonicalUrl: content.canonicalUrl,
    sourceKind: source.sourceKind,
    verifiedCreator: source.verifiedCreator,
    creatorClaimed: source.creatorClaimed,
    paidExcerpt: content.paidExcerpt,
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
        "You are Tollgate. STEP 2 is DRAFTING: answer the question grounded ONLY in the paidExcerpt of the purchased sources below. Every claim must cite the sourceId it came from. Return strict JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        stage: "draft",
        question,
        purchasedSources: purchasedSources.map(purchasedSourceSnapshot),
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
        'You are Tollgate. STEP 3 is SELF-CRITIQUE: check that every claim is supported by one of the purchased sourceIds. Rewrite the answer so it only keeps claims backed by a purchased source. groundedAnswer MUST be complete, publishable prose: when you drop a claim, rewrite the sentence around it rather than deleting the clause and leaving its comma, dash or conjunction behind. Never emit a fragment such as "provided, ." or "receipts—but ." If nothing survives, say plainly in one full sentence that the purchased sources do not answer the question. In sourceUsage, list EVERY purchased sourceId with used true or false; a source omitted from sourceUsage is treated as used. Return strict JSON.',
    },
    {
      role: "user",
      content: JSON.stringify({
        stage: "critique",
        question,
        purchasedSourceIds,
        draft,
        responseShape: {
          groundedAnswer: "string",
          verdict: "string",
          sourceUsage: [{ sourceId: "string", used: "boolean" }],
        },
      }),
    },
  ];
}

function escalationMessages(
  question: string,
  currentAnswer: string,
  providerLabel: string,
  externalAnswer: string,
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are Tollgate. STEP 5 is ESCALATION MERGE: an external paid agent has supplied grounding after local critique found unsupported claims. Merge only the useful grounded parts, clearly attribute the external paid agent, and return strict JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        stage: "escalate",
        question,
        currentAnswer,
        externalAssist: {
          provider: providerLabel,
          answer: externalAnswer,
        },
        responseShape: {
          groundedAnswer: "string",
        },
      }),
    },
  ];
}

export async function completeChat(
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
  // The redraft path assigns this answer straight through, so repairing only at
  // critique and escalation left the third door open — a redrafted answer went
  // out opening on a bare full stop. Repair every answer where it enters.
  const answer = repairRedactedProse(
    cleanModelText(parsed.answer, MAX_ANSWER_LENGTH),
  );
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
  const grounded = repairRedactedProse(
    cleanModelText(parsed.groundedAnswer, MAX_ANSWER_LENGTH),
  );
  const verdict = cleanModelText(parsed.verdict, MAX_REASON_LENGTH);
  // Only an explicit used:false marks a source unused. Omission from
  // sourceUsage means "used" — a forgetful model must never refund a cited
  // creator.
  const explicitlyUnusedSourceIds = new Set<string>();
  if (Array.isArray(parsed.sourceUsage)) {
    for (const item of parsed.sourceUsage) {
      if (!isRecord(item)) continue;
      const sourceId = cleanModelText(item.sourceId, 80);
      if (!sourceId) continue;
      if (item.used === false) explicitlyUnusedSourceIds.add(sourceId);
    }
  }
  return {
    groundedAnswer: grounded.length >= 40 ? grounded : fallbackAnswer,
    verdict,
    explicitlyUnusedSourceIds,
  };
}

function parseEscalationMerge(
  text: string,
  fallbackAnswer: string,
): EscalationMerge {
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed)) {
    throw new Error("LLM escalation JSON must be an object.");
  }
  const grounded = repairRedactedProse(
    cleanModelText(parsed.groundedAnswer, MAX_ANSWER_LENGTH),
  );
  return {
    groundedAnswer: grounded.length >= 40 ? grounded : fallbackAnswer,
  };
}

function escalationCapAtomicUsdc(): number {
  const raw = process.env.LEPTONWEB_ESCALATION_CAP_ATOMIC ?? "1500";
  const cap = Number(raw);
  return Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : 0;
}

// Prefers the cheapest configured x402 endpoint so the escalation cap admits
// the widest choice; with no allowlist configured this is the direct-transfer
// provider the agent has always used.
function defaultExternalProvider(): ExternalProvider {
  const [cheapest] = x402Providers().sort(
    (left, right) => left.priceAtomicUsdc - right.priceAtomicUsdc,
  );
  return cheapest ?? EXTERNAL_PROVIDERS.citepay;
}

function allocateFromAppraisals(
  appraisals: Appraisal[],
  sources: CreatorSource[],
  sourceBudgetAtomicUsdc: number,
  groundingYields?: GroundingYieldMap,
): { selected: CreatorSource[]; remainingAtomicUsdc: number } {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  // Buy the most grounding per USDC: rank "buy" verdicts by relevance-per-cost,
  // then by raw relevance, so the agent spends its budget where each atomic USDC
  // earns the most coverage instead of just chasing the most relevant source.
  const buys = appraisals
    .filter((appraisal) => appraisal.verdict === "buy")
    .map((appraisal) => ({
      appraisal,
      source: sourceById.get(appraisal.sourceId),
    }))
    .filter(
      (buy): buy is { appraisal: Appraisal; source: CreatorSource } =>
        buy.source !== undefined && buy.source.priceAtomicUsdc > 0,
    )
    .sort((a, b) => {
      const valueA =
        (a.appraisal.relevance / a.source.priceAtomicUsdc) *
        groundingYieldValue(groundingYields, a.source.id);
      const valueB =
        (b.appraisal.relevance / b.source.priceAtomicUsdc) *
        groundingYieldValue(groundingYields, b.source.id);
      return valueB - valueA || b.appraisal.relevance - a.appraisal.relevance;
    });
  const selected: CreatorSource[] = [];
  const seen = new Set<string>();
  let remainingAtomicUsdc = sourceBudgetAtomicUsdc;
  let probationSelected = false;

  for (const { source } of buys) {
    if (selected.length >= MAX_AGENT_SOURCES) break;
    if (seen.has(source.id)) continue;
    if (source.priceAtomicUsdc > remainingAtomicUsdc) continue;
    if (source.probation && probationSelected) continue;
    seen.add(source.id);
    selected.push(source);
    remainingAtomicUsdc -= source.priceAtomicUsdc;
    if (source.probation) probationSelected = true;
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
  externalProvider: ExternalProvider,
  strictMode: boolean,
  groundingYields?: GroundingYieldMap,
): Promise<AgentLoopResult> {
  const steps: AgentStep[] = [];
  const externalAssists: ExternalAssist[] = [];
  let stage: AgentStage = "appraise";

  try {
    const appraisals = await completeAndParse(
      appraiseMessages(question, sources, sourceBudgetAtomicUsdc),
      llmConfig,
      completeChat,
      parseAppraisals,
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
      groundingYields,
    );
    if (selected.length === 0) {
      steps.push({
        index: 1,
        name: "allocate",
        summary:
          "Bought 0 sources because the appraisal found no affordable relevant source.",
        detail:
          "No creator was paid; the agent did not draft from irrelevant registered sources.",
        spentAtomicUsdc: 0,
      });
      return {
        answer: NO_SOURCE_ANSWER,
        selected: [],
        unusedSourceIds: new Set(),
        steps,
        rationale:
          "No registered source was relevant enough to cite, so the agent bought nothing and did not fabricate an answer.",
        appraisalReason,
        externalAssists,
      };
    }
    steps.push({
      index: 1,
      name: "allocate",
      summary: `Allocated the budget to ${selected.length} source${
        selected.length === 1 ? "" : "s"
      } by best yield-adjusted grounding-per-USDC.`,
      detail: selected.map((source) => source.title).join(", "),
      spentAtomicUsdc: sourceBudgetAtomicUsdc - remainingAtomicUsdc,
    });

    stage = "draft";
    let draft = await completeAndParse(
      draftMessages(question, selected),
      llmConfig,
      completeChat,
      parseDraft,
    );
    steps.push({
      index: 2,
      name: "draft",
      summary: `Drafted an answer with ${draft.claims.length} grounded claim${
        draft.claims.length === 1 ? "" : "s"
      }.`,
      detail: "Every claim is tied to a purchased sourceId.",
    });

    const boughtIds = new Set(selected.map((source) => source.id));
    const unsupported = draft.claims.filter(
      (claim) => !boughtIds.has(claim.sourceId),
    );
    stage = "critique";
    const critique = await completeAndParse(
      critiqueMessages(question, draft, [...boughtIds]),
      llmConfig,
      completeChat,
      (text) => parseCritique(text, draft.answer),
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
    let unusedSourceIds = new Set(
      selected
        .filter((source) => critique.explicitlyUnusedSourceIds.has(source.id))
        .map((source) => source.id),
    );
    let unsupportedAfterRegistry = unsupported.length > 0;
    let rationale =
      critique.verdict ||
      `Bought ${selected.length} source${
        selected.length === 1 ? "" : "s"
      } and grounded the answer in them.`;

    if (unsupported.length > 0 && selected.length < MAX_AGENT_SOURCES) {
      const sourceById = new Map(sources.map((source) => [source.id, source]));
      const hasProbationSource = selected.some((source) => source.probation);
      const candidate = unsupported
        .map((claim) => sourceById.get(claim.sourceId))
        .find(
          (source): source is CreatorSource =>
            source !== undefined &&
            !boughtIds.has(source.id) &&
            !(source.probation && hasProbationSource) &&
            source.priceAtomicUsdc <= remainingAtomicUsdc,
        );
      if (candidate) {
        selected = [...selected, candidate];
        remainingAtomicUsdc -= candidate.priceAtomicUsdc;
        const nextBoughtIds = new Set(selected.map((source) => source.id));
        stage = "reflect";
        const reDraft = await completeAndParse(
          draftMessages(question, selected),
          llmConfig,
          completeChat,
          parseDraft,
        );
        draft = reDraft;
        answer = reDraft.answer;
        unusedSourceIds = new Set();
        unsupportedAfterRegistry = reDraft.claims.some(
          (claim) => !nextBoughtIds.has(claim.sourceId),
        );
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

    if (
      unsupportedAfterRegistry &&
      process.env.LEPTONWEB_ESCALATION === "1" &&
      externalAssists.length === 0 &&
      externalProvider.priceAtomicUsdc <= escalationCapAtomicUsdc()
    ) {
      stage = "escalate";
      // Money can move inside ask(): once it has, every failure below must
      // still record the paid assist + an escalate step — a post-transfer
      // error must never unwind to the deterministic fallback and lose the
      // spend from the record.
      let external: Awaited<ReturnType<ExternalProvider["ask"]>> | null = null;
      try {
        external = await externalProvider.ask(question);
        externalAssists.push(external.assist);
      } catch (error) {
        if (error instanceof EscalationPaidError) {
          externalAssists.push(error.assist);
          steps.push({
            index: steps.length,
            name: "escalate",
            summary: `Paid ${externalProvider.label} for external grounding, but the provider did not answer.`,
            detail: error.message,
            spentAtomicUsdc: error.assist.amountAtomicUsdc,
          });
          rationale = `${rationale} The agent paid ${externalProvider.label} to escalate, but the provider failed to answer; the payment is recorded and the answer keeps only registry-grounded claims.`;
        }
        // Pre-transfer failures (no money moved) fall through: no assist, no
        // step — the loop result stands on its registry grounding.
      }
      if (external) {
        // The external answer is untrusted third-party text: it reaches the
        // final answer only through the merge model, or — if the merge fails —
        // as a short, clearly delimited quote.
        const quotedExternal = cleanModelText(external.answer, 400);
        const fallbackAnswer = cleanModelText(
          `${answer} ${externalProvider.label} (paid external assist) says: "${quotedExternal}"`,
          MAX_ANSWER_LENGTH,
        );
        try {
          const merge = await completeAndParse(
            escalationMessages(
              question,
              answer,
              externalProvider.label,
              external.answer,
            ),
            llmConfig,
            completeChat,
            (text) => parseEscalationMerge(text, fallbackAnswer),
          );
          answer = merge.groundedAnswer;
        } catch (error) {
          if (strictMode) throw error;
          answer = fallbackAnswer;
        }
        steps.push({
          index: steps.length,
          name: "escalate",
          summary: `Bought external grounding from ${externalProvider.label} after unsupported claims remained.`,
          detail: `Provider ${externalProvider.id} answered query ${external.assist.queryId ?? "without a query id"}.`,
          spentAtomicUsdc: external.assist.amountAtomicUsdc,
        });
        rationale = `${rationale} Unsupported claims remained after registry reflect, so the agent escalated to ${externalProvider.label} and attributed the paid assist.`;
      }
    }

    return {
      answer,
      selected,
      unusedSourceIds,
      steps,
      rationale,
      appraisalReason,
      externalAssists,
    };
  } catch (error) {
    if (strictMode) throw new AgentPlanningError(stage, error);
    throw error;
  }
}

function buildLlmQueryRecord(
  question: string,
  createdAt: string,
  sources: CreatorSource[],
  loop: AgentLoopResult,
  model: string,
  readerPayment: QueryPaymentEvidence | undefined,
  groundingYields?: GroundingYieldMap,
): QueryRecord {
  const citationMarket = planCitationMarket(
    question,
    sources,
    MAX_AGENT_SOURCES,
    DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
    groundingYields,
  );
  // Repairing inside each parser kept missing a door — critique, escalation and
  // redraft were all patched and a redacted answer still reached the page. This
  // is the one place every answer must pass through on its way into a record, so
  // the guarantee belongs here. Applied before the hash so the integrity hash
  // covers exactly the text that gets published.
  const answer = repairRedactedProse(loop.answer);
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
  const citations: Citation[] = loop.selected.map((source) => {
    const content = buildSourceContent(source, createdAt);
    const refunded = loop.unusedSourceIds.has(source.id);
    return {
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
      canonicalUrl: content.canonicalUrl,
      previewExcerpt: content.previewExcerpt,
      paidExcerpt: content.paidExcerpt,
      sourceContentHash: content.contentHash,
      sourceExcerptHash: content.excerptHash,
      contentFetchedAt: content.fetchedAt,
      sourceKind: source.sourceKind,
      creatorKind: source.creatorKind,
      verifiedCreator: source.verifiedCreator,
      creatorClaimed: source.creatorClaimed,
      ownershipProof: source.ownershipProof,
      contributors: source.contributors,
      ...(refunded ? { payoutPolicy: "refund-unused" as const } : {}),
    };
  });
  const refundedAtomicUsdc = citations.reduce(
    (sum, citation) =>
      citation.payoutPolicy === "refund-unused"
        ? sum + citation.amountAtomicUsdc
        : sum,
    0,
  );
  const traceHash = sha256Hex({
    model,
    steps: loop.steps,
    sourceDecisions: decisions,
  });
  const queryHash = sha256Hex({
    question,
    citations,
    sourceDecisions: decisions,
    agentBudget: budget,
    readerPaymentHash: readerPayment?.paymentHash,
  });
  const answerHash = sha256Hex({
    answer,
    citations,
    sourceDecisions: decisions,
    agentBudget: budget,
    traceHash,
    readerPaymentHash: readerPayment?.paymentHash,
    // Binds the escalation payment proof (tx hash, provider answerHash) into
    // the record's integrity hash. Absent (undefined key is dropped by
    // stableStringify) when there was no escalation, so pre-existing records
    // hash identically.
    externalAssists:
      loop.externalAssists.length > 0 ? loop.externalAssists : undefined,
  });
  const id = sha256Hex({ createdAt, question, queryHash }).slice(0, 18);

  return {
    id,
    question,
    answer,
    queryHash,
    answerHash,
    totalAtomicUsdc: spentAtomicUsdc,
    citations,
    agentMode: "llm",
    agentModel: model,
    agentRationale: loop.rationale,
    sourceDecisions: decisions,
    agentBudget: budget,
    agentSteps: loop.steps,
    ...(loop.externalAssists.length > 0
      ? { externalAssists: loop.externalAssists }
      : {}),
    traceHash,
    receiptHashes: [],
    readerPayment,
    refundSummary: {
      boughtCount: citations.length,
      citedCount: citations.length - loop.unusedSourceIds.size,
      refundedCount: loop.unusedSourceIds.size,
      refundedAtomicUsdc,
    },
    createdAt,
  };
}

function deterministicFallback(
  question: string,
  createdAt: string,
  sources: CreatorSource[],
  readerPayment: QueryPaymentEvidence | undefined,
  reason: string,
  groundingYields?: GroundingYieldMap,
): QueryRecord {
  const record = createQueryRecord(
    question,
    createdAt,
    sources,
    readerPayment,
    groundingYields,
  );
  return {
    ...record,
    agentMode: "deterministic",
    agentRationale:
      record.citations.length === 0 ? record.agentRationale : reason,
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
  const withServerMode = (record: QueryRecord): QueryRecord =>
    options.serverMode
      ? { ...record, agentServerMode: options.serverMode }
      : record;
  if (!llmConfig) {
    if (options.strictMode) {
      throw new Error("Judge-strict mode requires a configured LLM planner.");
    }
    return withServerMode(
      deterministicFallback(
        question,
        createdAt,
        sources,
        readerPayment,
        "No LLM planner is configured; deterministic budget policy selected the citations.",
        options.groundingYields,
      ),
    );
  }

  try {
    const plannerChat = options.completeChat ?? completeChat;
    const loop = await runAgentLoop(
      question,
      sources,
      DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
      plannerChat,
      llmConfig,
      options.externalProvider ?? defaultExternalProvider(),
      options.strictMode === true,
      options.groundingYields,
    );
    return withServerMode(
      buildLlmQueryRecord(
        question,
        createdAt,
        sources,
        loop,
        llmConfig.model,
        readerPayment,
        options.groundingYields,
      ),
    );
  } catch (error) {
    if (options.strictMode) throw error;
    const message =
      error instanceof Error ? error.message : "LLM planner failed.";
    return deterministicFallback(
      question,
      createdAt,
      sources,
      readerPayment,
      `LLM planner fallback: ${message}`,
      options.groundingYields,
    );
  }
}
