import type { ClaimSupport, CreatorSource } from "../src/lib/types";
import type {
  BenchmarkCandidateProvenance,
  BenchmarkCandidateRole,
} from "./fixtures";
import {
  BENCHMARK_FIXTURE_VERSION,
  BENCHMARK_SOURCE_FIXTURE_HASH,
} from "./source-fixtures";

export const BOOTSTRAP_RESAMPLES = 10_000;
export const CENT_ATOMIC_USDC = 10_000;
export const BENCHMARK_STRATEGIES = [
  "random",
  "cheapest-first",
  "relevance-only",
  "full-llm",
] as const;

export type BenchmarkStrategy = (typeof BENCHMARK_STRATEGIES)[number];
export type BenchmarkMode = "partial" | "full-llm";
export type BenchmarkRunStatus = "measured" | "unavailable" | "error";
export type BenchmarkArmKind = "deterministic-fixture" | "live-llm";

export type BenchmarkCandidateMetadata = {
  sourceId: string;
  role: BenchmarkCandidateRole;
  provenance: BenchmarkCandidateProvenance;
  selected: boolean;
  priceAtomicUsdc: number;
  sourceKind: CreatorSource["sourceKind"];
  creatorKind: CreatorSource["creatorKind"];
  verifiedCreator: boolean;
  probation: boolean;
};

export type BenchmarkMeasurement = {
  spendAtomicUsdc: number;
  supportedClaims: number;
  unsupportedClaims: number;
  unableToVerifyClaims: number;
  totalClaims: number;
  supportedClaimsPerCent: number;
  unsupportedClaimRate: number;
  unusedPurchaseRate: number;
  unusedPurchases: number;
  budgetViolation: boolean;
  abstentionCorrect: boolean;
};

export type BenchmarkRun = {
  version: 2;
  fixtureVersion: typeof BENCHMARK_FIXTURE_VERSION;
  sourceFixtureHash: string;
  evalId: string;
  strategy: BenchmarkStrategy;
  armKind: BenchmarkArmKind;
  status: BenchmarkRunStatus;
  question: string;
  candidateSet: BenchmarkCandidateMetadata[];
  selectedSourceIds: string[];
  selectedRoles: BenchmarkCandidateRole[];
  model: string | null;
  spendAtomicUsdc: number | null;
  budgetAtomicUsdc: number;
  supportedClaims: number | null;
  unsupportedClaims: number | null;
  unableToVerifyClaims: number | null;
  totalClaims: number | null;
  supportedClaimsPerCent: number | null;
  unsupportedClaimRate: number | null;
  unusedPurchaseRate: number | null;
  unusedPurchases: number | null;
  budgetViolation: boolean | null;
  abstentionCorrect: boolean | null;
  repairAttempted?: boolean;
  error?: string;
};

export type MetricSummary = {
  mean: number | null;
  ci95: [number, number] | null;
};

export type StrategySummary = {
  armKind: BenchmarkArmKind;
  status: "measured" | "not-measured" | "mixed" | "failed";
  measuredCases: number;
  unavailableCases: number;
  errorCases: number;
  metrics: {
    supportedClaimsPerCent: MetricSummary;
    unsupportedClaimRate: MetricSummary;
    unusedPurchaseRate: MetricSummary;
    budgetViolationRate: MetricSummary;
    abstentionAccuracy: MetricSummary;
  };
};

export type BenchmarkSummary = {
  version: 2;
  runMode: BenchmarkMode;
  fixtureVersion: typeof BENCHMARK_FIXTURE_VERSION;
  sourceFixtureHash: string;
  evalCount: number;
  budgetAtomicUsdc: number;
  bootstrapResamples: typeof BOOTSTRAP_RESAMPLES;
  strategies: Record<BenchmarkStrategy, StrategySummary>;
};

export function computeBenchmarkMeasurement({
  selectedSources,
  claimSupport,
  expectedAbstention,
  budgetAtomicUsdc,
  maxSources = 3,
}: {
  selectedSources: CreatorSource[];
  claimSupport: ClaimSupport[];
  expectedAbstention: boolean;
  budgetAtomicUsdc: number;
  maxSources?: number;
}): BenchmarkMeasurement {
  const supported = claimSupport.filter((row) => row.status === "supported");
  const unsupported = claimSupport.filter(
    (row) => row.status === "unsupported",
  );
  const unable = claimSupport.filter(
    (row) => row.status === "unable-to-verify",
  );
  const spendAtomicUsdc = selectedSources.reduce(
    (sum, source) => sum + source.priceAtomicUsdc,
    0,
  );
  const usedSourceIds = new Set(
    supported.flatMap((row) => (row.sourceId ? [row.sourceId] : [])),
  );
  const unusedPurchases = selectedSources.filter(
    (source) => !usedSourceIds.has(source.id),
  ).length;

  return {
    spendAtomicUsdc,
    supportedClaims: supported.length,
    unsupportedClaims: unsupported.length,
    unableToVerifyClaims: unable.length,
    totalClaims: claimSupport.length,
    supportedClaimsPerCent:
      spendAtomicUsdc > 0
        ? supported.length / (spendAtomicUsdc / CENT_ATOMIC_USDC)
        : 0,
    unsupportedClaimRate:
      claimSupport.length > 0 ? unsupported.length / claimSupport.length : 0,
    unusedPurchaseRate:
      selectedSources.length > 0
        ? unusedPurchases / selectedSources.length
        : 0,
    unusedPurchases,
    budgetViolation:
      selectedSources.length > maxSources ||
      spendAtomicUsdc > budgetAtomicUsdc,
    abstentionCorrect: expectedAbstention
      ? selectedSources.length === 0
      : supported.length > 0,
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function bootstrapMeanCi(
  values: number[],
  seed: number,
): [number, number] | null {
  if (values.length === 0) return null;
  const random = seededRandom(seed);
  const samples: number[] = [];
  for (let iteration = 0; iteration < BOOTSTRAP_RESAMPLES; iteration += 1) {
    let total = 0;
    for (let index = 0; index < values.length; index += 1) {
      total += values[Math.floor(random() * values.length)] ?? 0;
    }
    samples.push(total / values.length);
  }
  samples.sort((left, right) => left - right);
  return [
    samples[Math.floor(BOOTSTRAP_RESAMPLES * 0.025)] ?? 0,
    samples[Math.ceil(BOOTSTRAP_RESAMPLES * 0.975) - 1] ?? 0,
  ];
}

function metric(
  runs: BenchmarkRun[],
  value: (run: BenchmarkRun) => number | null,
  seed: number,
): MetricSummary {
  const values = runs
    .filter((run) => run.status === "measured")
    .map(value)
    .filter((entry): entry is number => entry !== null);
  return { mean: mean(values), ci95: bootstrapMeanCi(values, seed) };
}

export function summarizeBenchmarkRuns({
  runs,
  runMode,
  evalCount,
  budgetAtomicUsdc,
}: {
  runs: BenchmarkRun[];
  runMode: BenchmarkMode;
  evalCount: number;
  budgetAtomicUsdc: number;
}): BenchmarkSummary {
  const strategies = Object.fromEntries(
    BENCHMARK_STRATEGIES.map((strategy, index) => {
      const strategyRuns = runs.filter((run) => run.strategy === strategy);
      const measuredCases = strategyRuns.filter(
        (run) => run.status === "measured",
      ).length;
      const unavailableCases = strategyRuns.filter(
        (run) => run.status === "unavailable",
      ).length;
      const errorCases = strategyRuns.filter(
        (run) => run.status === "error",
      ).length;
      const status =
        strategyRuns.length === 0
          ? "not-measured"
          : measuredCases === strategyRuns.length
            ? "measured"
            : measuredCases > 0
              ? "mixed"
              : errorCases > 0
                ? "failed"
                : "not-measured";
      return [
        strategy,
        {
          armKind:
            strategy === "full-llm"
              ? "live-llm"
              : "deterministic-fixture",
          status,
          measuredCases,
          unavailableCases,
          errorCases,
          metrics: {
            supportedClaimsPerCent: metric(
              strategyRuns,
              (run) => run.supportedClaimsPerCent,
              100 + index,
            ),
            unsupportedClaimRate: metric(
              strategyRuns,
              (run) => run.unsupportedClaimRate,
              200 + index,
            ),
            unusedPurchaseRate: metric(
              strategyRuns,
              (run) => run.unusedPurchaseRate,
              300 + index,
            ),
            budgetViolationRate: metric(
              strategyRuns,
              (run) =>
                run.budgetViolation === null
                  ? null
                  : run.budgetViolation
                    ? 1
                    : 0,
              400 + index,
            ),
            abstentionAccuracy: metric(
              strategyRuns,
              (run) =>
                run.abstentionCorrect === null
                  ? null
                  : run.abstentionCorrect
                    ? 1
                    : 0,
              500 + index,
            ),
          },
        } satisfies StrategySummary,
      ];
    }),
  ) as Record<BenchmarkStrategy, StrategySummary>;

  return {
    version: 2,
    runMode,
    fixtureVersion: BENCHMARK_FIXTURE_VERSION,
    sourceFixtureHash: BENCHMARK_SOURCE_FIXTURE_HASH,
    evalCount,
    budgetAtomicUsdc,
    bootstrapResamples: BOOTSTRAP_RESAMPLES,
    strategies,
  };
}

function displayMetric(value: MetricSummary): string {
  if (value.mean === null || value.ci95 === null) return "not measured";
  return `${value.mean.toFixed(4)} [${value.ci95[0].toFixed(4)}, ${value.ci95[1].toFixed(4)}]`;
}

export function benchmarkSummaryMarkdown(summary: BenchmarkSummary): string {
  const rows = BENCHMARK_STRATEGIES.map((strategy) => {
    const result = summary.strategies[strategy];
    const status = `${result.status} (${result.measuredCases}/${summary.evalCount}; ${result.unavailableCases} unavailable; ${result.errorCases} errors)`;
    return `| ${strategy} | ${result.armKind} | ${status} | ${displayMetric(result.metrics.supportedClaimsPerCent)} | ${displayMetric(result.metrics.unsupportedClaimRate)} | ${displayMetric(result.metrics.unusedPurchaseRate)} | ${displayMetric(result.metrics.budgetViolationRate)} | ${displayMetric(result.metrics.abstentionAccuracy)} |`;
  }).join("\n");

  return [
    "# Benchmark summary",
    "",
    `Run mode: ${summary.runMode}.`,
    `Fixed eval set: ${summary.evalCount} questions.`,
    `Budget: ${summary.budgetAtomicUsdc} atomic USDC.`,
    `Fixture: ${summary.fixtureVersion} (${summary.sourceFixtureHash}).`,
    `Intervals are deterministic 95% percentile bootstrap CIs from ${summary.bootstrapResamples.toLocaleString("en-US")} question-level resamples.`,
    "Supported claims per $0.01 uses 10,000 atomic USDC per cent.",
    "",
    "| strategy | arm | status | supported claims / $0.01 | unsupported-claim rate | unused-purchase rate | budget violation rate | abstention accuracy |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    rows,
    "",
    "The full-llm arm is a strict, live operator run. It remains not measured unless full-llm mode is explicitly selected and credentials are present; deterministic fixture execution is never reported under that label.",
    "",
  ].join("\n");
}
