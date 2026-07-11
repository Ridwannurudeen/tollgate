import {
  AgentPlanningError,
  completeChat,
  createAgentQueryRecord,
  llmConfigFromEnv,
  type ChatMessage,
  type CompleteChat,
  type LlmConfig,
} from "../src/lib/agent";
import {
  extractClaims,
  verifyClaims,
  type ClaimLlm,
} from "../src/lib/contribution";
import {
  DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  NO_SOURCE_ANSWER,
  planCitationMarket,
} from "../src/lib/engine";
import { buildSourceContent } from "../src/lib/source-content";
import type { CreatorSource, QueryRecord } from "../src/lib/types";
import { BENCHMARK_EVAL_SET, type BenchmarkCase } from "./eval-set";
import {
  buildBenchmarkPool,
  type BenchmarkPool,
} from "./fixtures";
import {
  BENCHMARK_STRATEGIES,
  computeBenchmarkMeasurement,
  type BenchmarkArmKind,
  type BenchmarkCandidateMetadata,
  type BenchmarkMeasurement,
  type BenchmarkMode,
  type BenchmarkRun,
  type BenchmarkRunStatus,
  type BenchmarkStrategy,
} from "./metrics";
import {
  BENCHMARK_FIXTURE_VERSION,
  BENCHMARK_SOURCE_FIXTURE_HASH,
} from "./source-fixtures";

export type LiveBenchmarkDependencies = {
  loadLlmConfig: () => LlmConfig | null;
  completeChat: CompleteChat;
  createAgentQueryRecord: typeof createAgentQueryRecord;
};

const LIVE_DEPENDENCIES: LiveBenchmarkDependencies = {
  loadLlmConfig: llmConfigFromEnv,
  completeChat,
  createAgentQueryRecord,
};

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function shuffled<T>(items: T[], seed: number): T[] {
  const result = [...items];
  const random = seededRandom(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function selectWithinBudget(order: CreatorSource[]): CreatorSource[] {
  const selected: CreatorSource[] = [];
  let remaining = DEFAULT_SOURCE_BUDGET_ATOMIC_USDC;
  for (const source of order) {
    if (selected.length >= 3) break;
    if (source.priceAtomicUsdc > remaining) continue;
    selected.push(source);
    remaining -= source.priceAtomicUsdc;
  }
  return selected;
}

export function selectBenchmarkSources(
  strategy: Exclude<BenchmarkStrategy, "full-llm">,
  testCase: BenchmarkCase,
  pool: BenchmarkPool,
): CreatorSource[] {
  if (strategy === "random") {
    return selectWithinBudget(
      shuffled(pool.sources, testCase.id.length * 97 + testCase.question.length),
    );
  }
  if (strategy === "cheapest-first") {
    return selectWithinBudget(
      [...pool.sources].sort(
        (left, right) =>
          left.priceAtomicUsdc - right.priceAtomicUsdc ||
          left.id.localeCompare(right.id),
      ),
    );
  }
  return planCitationMarket(
    testCase.question,
    pool.sources,
    3,
    DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  ).selectedSources;
}

function parseMessagePayload(messages: ChatMessage[]): Record<string, unknown> {
  const content = messages[1]?.content;
  if (!content) return {};
  const parsed: unknown = JSON.parse(content);
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : {};
}

function fixtureClaimExtractor(testCase: BenchmarkCase): ClaimLlm {
  return async (messages) => {
    const payload = parseMessagePayload(messages);
    const answer = typeof payload.answer === "string" ? payload.answer : "";
    const claims = testCase.claims
      .map((claim) => claim.text)
      .filter((claim) => answer.includes(claim));
    if (answer.includes("synthetic distractor claim")) {
      claims.push("synthetic distractor claim");
    }
    return JSON.stringify({ claims });
  };
}

function fixtureClaimVerifier(
  testCase: BenchmarkCase,
  selectedSources: CreatorSource[],
): ClaimLlm {
  return async (messages) => {
    const payload = parseMessagePayload(messages);
    const claims = Array.isArray(payload.claims)
      ? payload.claims.filter(
          (claim): claim is string => typeof claim === "string",
        )
      : [];
    const supports = claims.map((claim) => {
      const expected = testCase.claims.find(
        (candidate) => candidate.text === claim,
      );
      if (!expected) return { claim, sourceId: null, span: null };
      const source = selectedSources.find((candidate) =>
        buildSourceContent(candidate, "benchmark").paidExcerpt.includes(
          expected.span,
        ),
      );
      return source
        ? { claim, sourceId: source.id, span: expected.span }
        : { claim, sourceId: null, span: null };
    });
    return JSON.stringify({ supports });
  };
}

function localAnswer(
  testCase: BenchmarkCase,
  selectedSources: CreatorSource[],
): string {
  const supportedClaims = testCase.claims
    .filter((claim) =>
      selectedSources.some((source) =>
        buildSourceContent(source, "benchmark").paidExcerpt.includes(
          claim.span,
        ),
      ),
    )
    .map((claim) => claim.text);
  const hasUnusedCandidate = selectedSources.some(
    (source) =>
      !testCase.claims.some((claim) =>
        buildSourceContent(source, "benchmark").paidExcerpt.includes(
          claim.span,
        ),
      ),
  );
  if (supportedClaims.length === 0 && !hasUnusedCandidate) return "";
  return [
    ...supportedClaims,
    ...(hasUnusedCandidate ? ["synthetic distractor claim"] : []),
  ].join(" ");
}

async function analyzeAnswer(
  testCase: BenchmarkCase,
  selectedSources: CreatorSource[],
  answer: string,
  extractor: ClaimLlm,
  verifier: ClaimLlm,
  strictVerifier = false,
): Promise<BenchmarkMeasurement> {
  const claims = answer ? await extractClaims(answer, extractor) : [];
  const claimSupport = await verifyClaims(claims, selectedSources, verifier);
  if (
    strictVerifier &&
    claimSupport.length > 0 &&
    claimSupport.every((support) => support.status === "unable-to-verify")
  ) {
    throw new Error("Strict live claim verifier could not verify any claim.");
  }
  return computeBenchmarkMeasurement({
    selectedSources,
    claimSupport,
    expectedAbstention: testCase.expectedAbstention,
    budgetAtomicUsdc: DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  });
}

function armKind(strategy: BenchmarkStrategy): BenchmarkArmKind {
  return strategy === "full-llm" ? "live-llm" : "deterministic-fixture";
}

function candidateSet(
  pool: BenchmarkPool,
  selectedSources: CreatorSource[],
): BenchmarkCandidateMetadata[] {
  const selectedIds = new Set(selectedSources.map((source) => source.id));
  return pool.candidates.map(({ source, role, provenance }) => ({
    sourceId: source.id,
    role,
    provenance: { ...provenance },
    selected: selectedIds.has(source.id),
    priceAtomicUsdc: source.priceAtomicUsdc,
    sourceKind: source.sourceKind,
    creatorKind: source.creatorKind,
    verifiedCreator: source.verifiedCreator,
    probation: source.probation === true,
  }));
}

function baseRun(
  testCase: BenchmarkCase,
  strategy: BenchmarkStrategy,
  status: BenchmarkRunStatus,
  pool: BenchmarkPool,
  selectedSources: CreatorSource[],
  model: string | null,
): Omit<
  BenchmarkRun,
  | "spendAtomicUsdc"
  | "supportedClaims"
  | "unsupportedClaims"
  | "unableToVerifyClaims"
  | "totalClaims"
  | "supportedClaimsPerCent"
  | "unsupportedClaimRate"
  | "unusedPurchaseRate"
  | "unusedPurchases"
  | "budgetViolation"
  | "abstentionCorrect"
> {
  return {
    version: 2,
    fixtureVersion: BENCHMARK_FIXTURE_VERSION,
    sourceFixtureHash: BENCHMARK_SOURCE_FIXTURE_HASH,
    evalId: testCase.id,
    strategy,
    armKind: armKind(strategy),
    status,
    question: testCase.question,
    candidateSet: candidateSet(pool, selectedSources),
    selectedSourceIds: selectedSources.map((source) => source.id),
    selectedRoles: selectedSources.map((source) => pool.roles[source.id]),
    model,
    budgetAtomicUsdc: DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
  };
}

function measuredRun(
  testCase: BenchmarkCase,
  strategy: BenchmarkStrategy,
  pool: BenchmarkPool,
  selectedSources: CreatorSource[],
  measurement: BenchmarkMeasurement,
  model: string | null,
): BenchmarkRun {
  return {
    ...baseRun(
      testCase,
      strategy,
      "measured",
      pool,
      selectedSources,
      model,
    ),
    ...measurement,
  };
}

function incompleteRun(
  testCase: BenchmarkCase,
  strategy: BenchmarkStrategy,
  status: Exclude<BenchmarkRunStatus, "measured">,
  pool: BenchmarkPool,
  error: string,
  model: string | null,
): BenchmarkRun {
  return {
    ...baseRun(testCase, strategy, status, pool, [], model),
    spendAtomicUsdc: null,
    supportedClaims: null,
    unsupportedClaims: null,
    unableToVerifyClaims: null,
    totalClaims: null,
    supportedClaimsPerCent: null,
    unsupportedClaimRate: null,
    unusedPurchaseRate: null,
    unusedPurchases: null,
    budgetViolation: null,
    abstentionCorrect: null,
    error,
  };
}

async function runLiveCase(
  testCase: BenchmarkCase,
  pool: BenchmarkPool,
  config: LlmConfig,
  dependencies: LiveBenchmarkDependencies,
): Promise<BenchmarkRun> {
  try {
    const query: QueryRecord = await dependencies.createAgentQueryRecord(
      testCase.question,
      "2026-07-11T00:00:00.000Z",
      pool.sources,
      undefined,
      {
        llmConfig: config,
        completeChat: dependencies.completeChat,
        strictMode: true,
        serverMode: "judge-strict",
      },
    );
    if (
      query.agentMode !== "llm" ||
      query.agentServerMode !== "judge-strict"
    ) {
      throw new Error("Strict live benchmark returned a non-strict LLM record.");
    }
    const selectedSources = pool.sources.filter((source) =>
      query.citations.some((citation) => citation.sourceId === source.id),
    );
    const liveClaimExtractor: ClaimLlm = (messages) =>
      dependencies.completeChat(messages, config);
    const verifierConfig = {
      ...config,
      model: process.env.LEPTONWEB_VERIFIER_MODEL?.trim() || config.model,
    };
    const liveClaimVerifier: ClaimLlm = (messages) =>
      dependencies.completeChat(messages, verifierConfig);
    const measurement = await analyzeAnswer(
      testCase,
      selectedSources,
      query.answer === NO_SOURCE_ANSWER ? "" : query.answer,
      liveClaimExtractor,
      liveClaimVerifier,
      true,
    );
    return measuredRun(
      testCase,
      "full-llm",
      pool,
      selectedSources,
      measurement,
      query.agentModel ?? config.model,
    );
  } catch (error) {
    const message =
      error instanceof AgentPlanningError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Full-LLM benchmark case failed.";
    return incompleteRun(
      testCase,
      "full-llm",
      "error",
      pool,
      message,
      config.model,
    );
  }
}

async function runCase(
  testCase: BenchmarkCase,
  strategy: BenchmarkStrategy,
  mode: BenchmarkMode,
  liveConfig: LlmConfig | null | undefined,
  dependencies: LiveBenchmarkDependencies,
): Promise<BenchmarkRun> {
  const pool = buildBenchmarkPool(testCase);
  if (strategy !== "full-llm") {
    const selectedSources = selectBenchmarkSources(strategy, testCase, pool);
    const measurement = await analyzeAnswer(
      testCase,
      selectedSources,
      localAnswer(testCase, selectedSources),
      fixtureClaimExtractor(testCase),
      fixtureClaimVerifier(testCase, selectedSources),
    );
    return measuredRun(
      testCase,
      strategy,
      pool,
      selectedSources,
      measurement,
      null,
    );
  }

  if (mode === "partial") {
    return incompleteRun(
      testCase,
      strategy,
      "unavailable",
      pool,
      "Operator-required live LLM arm was not run in explicit partial mode.",
      null,
    );
  }
  if (!liveConfig) {
    return incompleteRun(
      testCase,
      strategy,
      "unavailable",
      pool,
      "Live LLM credentials are unavailable; set LEPTONWEB_LLM_API_KEY and LEPTONWEB_LLM_MODEL for the operator run.",
      null,
    );
  }
  return runLiveCase(testCase, pool, liveConfig, dependencies);
}

export async function runBenchmark(
  mode: BenchmarkMode,
  dependencies: LiveBenchmarkDependencies = LIVE_DEPENDENCIES,
): Promise<BenchmarkRun[]> {
  const liveConfig =
    mode === "full-llm" ? dependencies.loadLlmConfig() : undefined;
  const runs: BenchmarkRun[] = [];
  for (const testCase of BENCHMARK_EVAL_SET) {
    for (const strategy of BENCHMARK_STRATEGIES) {
      runs.push(
        await runCase(testCase, strategy, mode, liveConfig, dependencies),
      );
    }
  }
  return runs;
}
