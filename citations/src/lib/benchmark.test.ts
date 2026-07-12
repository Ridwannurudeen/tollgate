import { describe, expect, it, vi } from "vitest";
import { BENCHMARK_EVAL_SET } from "../../bench/eval-set";
import {
  buildBenchmarkPool,
  type BenchmarkCandidateRole,
} from "../../bench/fixtures";
import {
  BOOTSTRAP_RESAMPLES,
  bootstrapMeanCi,
  computeBenchmarkMeasurement,
  mean,
} from "../../bench/metrics";
import {
  runBenchmark,
  selectBenchmarkSources,
  type LiveBenchmarkDependencies,
} from "../../bench/runner";
import {
  BENCHMARK_SOURCE_FIXTURES,
  BENCHMARK_SOURCE_FIXTURE_HASH,
} from "../../bench/source-fixtures";
import { createAgentQueryRecord } from "./agent";
import { REPAIR_PROMPT } from "./json-parse";
import { buildSourceContent } from "./source-content";
import type { ClaimSupport, CreatorSource } from "./types";

const DETERMINISTIC_STRATEGIES = [
  "random",
  "cheapest-first",
  "relevance-only",
] as const;

const SOURCE_A: CreatorSource = {
  id: "source-a",
  title: "Source A",
  creator: "Benchmark A",
  handle: "@benchmark-a",
  wallet: "0x1111111111111111111111111111111111111111",
  url: "https://example.com/a",
  summary: "Source A supports two claims.",
  tags: ["benchmark"],
  priceAtomicUsdc: 2_500,
  sourceKind: "internal-test",
  creatorKind: "internal-test",
  verifiedCreator: true,
};

const SOURCE_B: CreatorSource = {
  ...SOURCE_A,
  id: "source-b",
  title: "Source B",
  creator: "Benchmark B",
  handle: "@benchmark-b",
  wallet: "0x2222222222222222222222222222222222222222",
  url: "https://example.com/b",
  summary: "Source B is unused.",
  priceAtomicUsdc: 1_500,
};

describe("WS5 benchmark", () => {
  it("contains exactly 50 unique evaluation cases", () => {
    expect(BENCHMARK_EVAL_SET).toHaveLength(50);
    expect(
      new Set(BENCHMARK_EVAL_SET.map((testCase) => testCase.id)).size,
    ).toBe(50);
    expect(
      BENCHMARK_EVAL_SET.filter((testCase) => testCase.expectedAbstention),
    ).toHaveLength(10);
    expect(
      BENCHMARK_EVAL_SET.filter((testCase) => !testCase.expectedAbstention),
    ).toHaveLength(40);
  });

  it("keeps frozen provenance, valid candidate roles, and literal gold spans", () => {
    expect(Object.isFrozen(BENCHMARK_SOURCE_FIXTURES)).toBe(true);
    expect(BENCHMARK_SOURCE_FIXTURE_HASH).toMatch(/^0x[0-9a-f]{64}$/);
    for (const fixture of BENCHMARK_SOURCE_FIXTURES) {
      expect(Object.isFrozen(fixture)).toBe(true);
      expect(Object.isFrozen(fixture.tags)).toBe(true);
      expect(Object.isFrozen(fixture.ownershipProof)).toBe(true);
    }

    for (const testCase of BENCHMARK_EVAL_SET) {
      const pool = buildBenchmarkPool(testCase);
      const roles = pool.candidates.map((candidate) => candidate.role);
      const expectedRoles: BenchmarkCandidateRole[] = testCase.goldSourceId
        ? ["gold", "duplicate", "cheap-junk", "expensive-good", "unverified"]
        : [
            "duplicate",
            "cheap-junk",
            "expensive-good",
            "unverified",
            "irrelevant",
          ];
      expect(roles).toEqual(expectedRoles);
      expect(new Set(pool.sources.map((source) => source.id)).size).toBe(
        pool.sources.length,
      );

      for (const candidate of pool.candidates) {
        expect(
          BENCHMARK_SOURCE_FIXTURES.some(
            (fixture) => fixture.id === candidate.provenance.sourceFixtureId,
          ),
        ).toBe(true);
        expect(candidate.provenance.synthetic).toBe(candidate.role !== "gold");
        expect(candidate.provenance.kind).toBe(
          candidate.role === "gold" ? "frozen-source" : "synthetic-derived",
        );
      }

      if (!testCase.goldSourceId) {
        expect(testCase.claims).toEqual([]);
        continue;
      }
      const gold = pool.candidates.find(
        (candidate) => candidate.role === "gold",
      );
      if (!gold) {
        throw new Error("Covered benchmark case is missing its gold source.");
      }
      expect(gold.source.id).toBe(testCase.goldSourceId);
      const paidExcerpt = buildSourceContent(
        gold.source,
        "benchmark",
      ).paidExcerpt;
      for (const claim of testCase.claims) {
        expect(claim.text).toContain(claim.span);
        expect(paidExcerpt).toContain(claim.span);
      }
    }
  });

  it("selects every deterministic arm reproducibly", () => {
    for (const testCase of BENCHMARK_EVAL_SET) {
      for (const strategy of DETERMINISTIC_STRATEGIES) {
        const first = selectBenchmarkSources(
          strategy,
          testCase,
          buildBenchmarkPool(testCase),
        ).map((source) => source.id);
        const second = selectBenchmarkSources(
          strategy,
          testCase,
          buildBenchmarkPool(testCase),
        ).map((source) => source.id);
        expect(second).toEqual(first);
      }
    }
  });

  it("matches hand-computed metrics and a hand-computed bootstrap interval", () => {
    const claimSupport: ClaimSupport[] = [
      { claim: "A", sourceId: SOURCE_A.id, span: "A", status: "supported" },
      { claim: "B", sourceId: SOURCE_A.id, span: "B", status: "supported" },
      { claim: "C", sourceId: null, span: null, status: "unsupported" },
    ];

    expect(
      computeBenchmarkMeasurement({
        selectedSources: [SOURCE_A, SOURCE_B],
        claimSupport,
        expectedAbstention: false,
        budgetAtomicUsdc: 6_500,
      }),
    ).toEqual({
      spendAtomicUsdc: 4_000,
      supportedClaims: 2,
      unsupportedClaims: 1,
      unableToVerifyClaims: 0,
      totalClaims: 3,
      supportedClaimsPerCent: 5,
      unsupportedClaimRate: 1 / 3,
      unusedPurchaseRate: 1 / 2,
      unusedPurchases: 1,
      budgetViolation: false,
      abstentionCorrect: true,
    });
    expect(BOOTSTRAP_RESAMPLES).toBe(10_000);
    expect(mean([0.25, 0.25, 0.25])).toBe(0.25);
    expect(bootstrapMeanCi([0.25, 0.25, 0.25], 19)).toEqual([0.25, 0.25]);
    expect(bootstrapMeanCi([0, 1], 19)).toEqual([0, 1]);
  });

  it("runs the partial arm without credentials or network access", async () => {
    const envNames = [
      "LEPTONWEB_LLM_API_KEY",
      "OPENAI_API_KEY",
      "LEPTONWEB_LLM_MODEL",
      "LEPTONWEB_LLM_BASE_URL",
    ];
    const previous = new Map(envNames.map((name) => [name, process.env[name]]));
    for (const name of envNames) delete process.env[name];

    const fetchMock = vi.fn(() => {
      throw new Error("Partial benchmark attempted network access.");
    });
    vi.stubGlobal("fetch", fetchMock);
    const loadLlmConfig = vi.fn(() => {
      throw new Error("Partial benchmark attempted to read LLM credentials.");
    });
    const dependencies: LiveBenchmarkDependencies = {
      loadLlmConfig,
      completeChat: async () => {
        throw new Error("Partial benchmark called the live chat client.");
      },
      createAgentQueryRecord: async () => {
        throw new Error("Partial benchmark called the live agent runner.");
      },
    };

    try {
      const runs = await runBenchmark("partial", dependencies);
      expect(runs).toHaveLength(200);
      expect(runs.filter((run) => run.status === "measured")).toHaveLength(150);
      expect(
        runs.filter(
          (run) => run.strategy === "full-llm" && run.status === "unavailable",
        ),
      ).toHaveLength(50);
      expect(runs.some((run) => run.status === "error")).toBe(false);
      expect(loadLlmConfig).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      for (const run of runs) {
        expect(run.candidateSet).toHaveLength(5);
        expect(run.candidateSet.every((candidate) => candidate.role)).toBe(
          true,
        );
        expect(
          run.candidateSet.every(
            (candidate) => candidate.provenance.sourceFixtureId,
          ),
        ).toBe(true);
      }

      const noSecretConfig = vi.fn(() => null);
      const noSecretRuns = await runBenchmark("full-llm", {
        ...dependencies,
        loadLlmConfig: noSecretConfig,
      });
      expect(noSecretConfig).toHaveBeenCalledOnce();
      expect(
        noSecretRuns.filter(
          (run) => run.strategy === "full-llm" && run.status === "unavailable",
        ),
      ).toHaveLength(50);
      expect(noSecretRuns.some((run) => run.status === "error")).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("records whether the live arm attempted JSON repair", async () => {
    const config = {
      baseUrl: "https://example.com/v1",
      apiKey: "test",
      model: "test-model",
    };
    const runLive = (malformedFirstResponse: boolean) =>
      runBenchmark("full-llm", {
        loadLlmConfig: () => config,
        completeChat: async (messages) => {
          if (messages[messages.length - 1]?.content === REPAIR_PROMPT) {
            return JSON.stringify({ appraisals: [] });
          }
          return malformedFirstResponse
            ? "not json"
            : JSON.stringify({ appraisals: [] });
        },
        createAgentQueryRecord,
      });

    const repairedRuns = (await runLive(true)).filter(
      (run) => run.strategy === "full-llm",
    );
    const unrepairedRuns = (await runLive(false)).filter(
      (run) => run.strategy === "full-llm",
    );

    expect(repairedRuns).toHaveLength(50);
    expect(repairedRuns.every((run) => run.status === "measured")).toBe(true);
    expect(repairedRuns.every((run) => run.repairAttempted === true)).toBe(
      true,
    );
    expect(unrepairedRuns).toHaveLength(50);
    expect(unrepairedRuns.every((run) => run.status === "measured")).toBe(true);
    expect(unrepairedRuns.every((run) => run.repairAttempted === false)).toBe(
      true,
    );
  });
});
