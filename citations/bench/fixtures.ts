import type { CreatorSource } from "../src/lib/types";
import type { BenchmarkCase } from "./eval-set";
import {
  BENCHMARK_FIXTURE_VERSION,
  BENCHMARK_SOURCE_FIXTURES,
  cloneBenchmarkSource,
} from "./source-fixtures";

export type BenchmarkCandidateRole =
  | "gold"
  | "duplicate"
  | "cheap-junk"
  | "expensive-good"
  | "unverified"
  | "irrelevant";

export type BenchmarkCandidateProvenance = {
  fixtureVersion: typeof BENCHMARK_FIXTURE_VERSION;
  sourceFixtureId: string;
  kind: "frozen-source" | "synthetic-derived";
  synthetic: boolean;
};

export type BenchmarkPoolCandidate = {
  source: CreatorSource;
  role: BenchmarkCandidateRole;
  provenance: BenchmarkCandidateProvenance;
};

export type BenchmarkPool = {
  sources: CreatorSource[];
  roles: Record<string, BenchmarkCandidateRole>;
  candidates: BenchmarkPoolCandidate[];
};

const JUNK_SUMMARY =
  "This synthetic distractor contains no evidence about the evaluated question.";
const IRRELEVANT_SUMMARY =
  "This synthetic source discusses unrelated weather and cooking topics.";

function benchmarkWallet(index: number): CreatorSource["wallet"] {
  return ("0x" + index.toString(16).padStart(40, "0")) as CreatorSource["wallet"];
}

function copySource(
  base: CreatorSource,
  role: BenchmarkCandidateRole,
  index: number,
  overrides: Partial<CreatorSource> = {},
): CreatorSource {
  const sourceKind =
    role === "unverified" ? "external" : ("internal-test" as const);
  const creatorKind =
    role === "unverified" ? "external" : ("internal-test" as const);
  return {
    ...base,
    id: "bench-" + role + "-" + String(index),
    title: base.title + " [" + role + "]",
    creator: "Synthetic benchmark " + role,
    handle: "@bench" + index,
    wallet: benchmarkWallet(index),
    summary: overrides.summary ?? base.summary,
    priceAtomicUsdc: overrides.priceAtomicUsdc ?? base.priceAtomicUsdc,
    sourceKind,
    creatorKind,
    verifiedCreator: role === "expensive-good",
    creatorClaimed: false,
    probation: role === "unverified",
    ownershipProof: undefined,
    origin: undefined,
    ...overrides,
  };
}

export function buildBenchmarkPool(testCase: BenchmarkCase): BenchmarkPool {
  const baseFixture = testCase.goldSourceId
    ? BENCHMARK_SOURCE_FIXTURES.find(
        (source) => source.id === testCase.goldSourceId,
      )
    : BENCHMARK_SOURCE_FIXTURES[0];
  if (!baseFixture) {
    throw new Error("Benchmark gold source is not in the frozen fixture corpus.");
  }
  const base = cloneBenchmarkSource(baseFixture);

  const candidates: BenchmarkPoolCandidate[] = [];
  const roles: Record<string, BenchmarkCandidateRole> = {};
  const add = (
    source: CreatorSource,
    role: BenchmarkCandidateRole,
    kind: BenchmarkCandidateProvenance["kind"],
  ) => {
    candidates.push({
      source,
      role,
      provenance: {
        fixtureVersion: BENCHMARK_FIXTURE_VERSION,
        sourceFixtureId: baseFixture.id,
        kind,
        synthetic: kind === "synthetic-derived",
      },
    });
    roles[source.id] = role;
  };

  if (testCase.goldSourceId) add(base, "gold", "frozen-source");
  add(
    copySource(base, "duplicate", 10_000 + candidates.length, {
      priceAtomicUsdc: Math.max(100, base.priceAtomicUsdc + 100),
    }),
    "duplicate",
    "synthetic-derived",
  );
  add(
    copySource(base, "cheap-junk", 20_000 + candidates.length, {
      summary: JUNK_SUMMARY,
      priceAtomicUsdc: 100,
    }),
    "cheap-junk",
    "synthetic-derived",
  );
  add(
    copySource(base, "expensive-good", 30_000 + candidates.length, {
      priceAtomicUsdc: 5_900,
    }),
    "expensive-good",
    "synthetic-derived",
  );
  add(
    copySource(base, "unverified", 40_000 + candidates.length, {
      priceAtomicUsdc: 700,
    }),
    "unverified",
    "synthetic-derived",
  );

  if (!testCase.goldSourceId) {
    add(
      copySource(base, "irrelevant", 50_000 + candidates.length, {
        summary: IRRELEVANT_SUMMARY,
        priceAtomicUsdc: 200,
      }),
      "irrelevant",
      "synthetic-derived",
    );
  }

  return {
    candidates,
    roles,
    sources: candidates.map((candidate) => candidate.source),
  };
}
