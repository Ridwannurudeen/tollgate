import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SOURCE_BUDGET_ATOMIC_USDC } from "../src/lib/engine";
import { BENCHMARK_EVAL_SET } from "./eval-set";
import {
  benchmarkSummaryMarkdown,
  summarizeBenchmarkRuns,
  type BenchmarkMode,
} from "./metrics";
import { runBenchmark } from "./runner";

export const BENCHMARK_JSONL_FILENAME = "benchmark.jsonl";

function parseMode(args: string[]): BenchmarkMode {
  const inline = args.find((argument) => argument.startsWith("--mode="));
  const flagIndex = args.indexOf("--mode");
  const value = inline?.slice("--mode=".length) ?? args[flagIndex + 1];
  if (value === undefined) return "partial";
  if (value === "partial" || value === "full-llm") return value;
  throw new Error(
    "Benchmark mode must be partial (offline) or full-llm (operator-run live arm).",
  );
}

const runMode = parseMode(process.argv.slice(2));
const runs = await runBenchmark(runMode);
const summary = summarizeBenchmarkRuns({
  runs,
  runMode,
  evalCount: BENCHMARK_EVAL_SET.length,
  budgetAtomicUsdc: DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
});
const resultsDir = path.join(process.cwd(), "bench", "results");

await mkdir(resultsDir, { recursive: true });
await writeFile(
  path.join(resultsDir, BENCHMARK_JSONL_FILENAME),
  `${runs.map((run) => JSON.stringify(run)).join("\n")}\n`,
  "utf8",
);
await writeFile(
  path.join(resultsDir, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(resultsDir, "summary.md"),
  benchmarkSummaryMarkdown(summary),
  "utf8",
);

console.log(JSON.stringify(summary, null, 2));
