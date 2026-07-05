import type { QueryRecord } from "./types";

function latestByCreatedAt(queries: QueryRecord[]): QueryRecord | null {
  return queries.reduce<QueryRecord | null>((latest, query) => {
    if (!latest) return query;
    return Date.parse(query.createdAt) > Date.parse(latest.createdAt)
      ? query
      : latest;
  }, null);
}

export function latestShowcaseQuery(
  queries: QueryRecord[],
): QueryRecord | null {
  const latestLlmQuery = latestByCreatedAt(
    queries.filter((query) => query.agentMode === "llm"),
  );
  return latestLlmQuery ?? latestByCreatedAt(queries);
}

export function displayAgentRationale(rationale?: string): string | null {
  if (!rationale) return null;
  if (rationale.startsWith("LLM planner fallback")) {
    return "deterministic planner (LLM unavailable)";
  }
  return rationale;
}

export function answerModeLabel(query: QueryRecord): string {
  if (query.agentMode === "llm") return "latest agent-planned answer";
  return "latest deterministic answer";
}

export function agentTraceLabel(query: QueryRecord): string {
  if (query.agentMode === "llm") {
    return query.agentModel
      ? `planned by ${query.agentModel}`
      : "planned by LLM";
  }
  return "deterministic planner";
}
