import { DEFAULT_CREATOR_SOURCES } from "./catalog";
import { sha256Hex } from "./hash";
import { buildSourceContent, type SourceContent } from "./source-content";
import type {
  AgentBudget,
  AgentStep,
  Citation,
  CreatorSource,
  QueryPaymentEvidence,
  QueryRecord,
  SourceDecision,
} from "./types";

export const DEFAULT_SOURCE_BUDGET_ATOMIC_USDC = 6_500;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "to",
  "what",
  "when",
  "where",
  "why",
  "with",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function scoreSource(questionTokens: string[], source: CreatorSource): number {
  const haystack = tokenize(
    `${source.title} ${source.summary} ${source.tags.join(" ")}`,
  );
  const haystackSet = new Set(haystack);
  const exactMatches = questionTokens.filter((token) =>
    haystackSet.has(token),
  ).length;
  const partialMatches = questionTokens.filter((token) =>
    haystack.some((word) => word.includes(token) || token.includes(word)),
  ).length;
  const tagMatches = source.tags.filter((tag) =>
    questionTokens.includes(tag),
  ).length;
  return exactMatches * 4 + partialMatches + tagMatches * 3;
}

export function selectSources(
  question: string,
  sources: CreatorSource[] = DEFAULT_CREATOR_SOURCES,
  limit = 3,
): CreatorSource[] {
  return planCitationMarket(question, sources, limit).selectedSources;
}

function rankSources(question: string, sources: CreatorSource[]) {
  const tokens = tokenize(question);
  const ranked = sources
    .map((source, index) => ({
      source,
      score: scoreSource(tokens, source),
      index,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.source.priceAtomicUsdc - b.source.priceAtomicUsdc ||
        a.index - b.index,
    );

  const matched = ranked.filter((item) => item.score > 0);
  return matched.length > 0 ? matched : ranked;
}

function decisionReason(
  source: CreatorSource,
  score: number,
  selected: boolean,
  remainingBudget: number,
): string {
  if (selected) {
    return `Bought: relevance score ${score} cleared the budget policy.`;
  }
  if (score <= 0) {
    return "Skipped: no useful overlap with this question.";
  }
  if (source.priceAtomicUsdc > remainingBudget) {
    return `Skipped: ${source.priceAtomicUsdc} atomic USDC exceeded the remaining source budget.`;
  }
  return "Skipped: lower value than the purchased source bundle.";
}

export function planCitationMarket(
  question: string,
  sources: CreatorSource[] = DEFAULT_CREATOR_SOURCES,
  limit = 3,
  sourceBudgetAtomicUsdc = DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
): {
  selectedSources: CreatorSource[];
  decisions: SourceDecision[];
  budget: AgentBudget;
} {
  const ranked = rankSources(question, sources);
  const selectedIds = new Set<string>();
  const selectedSources: CreatorSource[] = [];
  let remainingAtomicUsdc = sourceBudgetAtomicUsdc;

  for (const item of ranked) {
    if (selectedSources.length >= limit) break;
    if (item.score <= 0) continue;
    if (item.source.priceAtomicUsdc > remainingAtomicUsdc) continue;
    selectedIds.add(item.source.id);
    selectedSources.push(item.source);
    remainingAtomicUsdc -= item.source.priceAtomicUsdc;
  }

  if (selectedSources.length === 0) {
    const fallback = ranked.find(
      (item) => item.source.priceAtomicUsdc <= sourceBudgetAtomicUsdc,
    );
    if (fallback) {
      selectedIds.add(fallback.source.id);
      selectedSources.push(fallback.source);
      remainingAtomicUsdc =
        sourceBudgetAtomicUsdc - fallback.source.priceAtomicUsdc;
    }
  }

  const decisions = ranked.map((item) => {
    const selected = selectedIds.has(item.source.id);
    return {
      sourceId: item.source.id,
      title: item.source.title,
      creator: item.source.creator,
      priceAtomicUsdc: item.source.priceAtomicUsdc,
      score: item.score,
      valuePerAtomicUsdc:
        Math.round((item.score / item.source.priceAtomicUsdc) * 1_000_000) /
        1_000_000,
      selected,
      reason: decisionReason(
        item.source,
        item.score,
        selected,
        remainingAtomicUsdc,
      ),
    };
  });

  const spentAtomicUsdc = sourceBudgetAtomicUsdc - remainingAtomicUsdc;
  return {
    selectedSources,
    decisions,
    budget: {
      sourceBudgetAtomicUsdc,
      spentAtomicUsdc,
      remainingAtomicUsdc,
      candidateCount: ranked.length,
      purchasedCount: selectedSources.length,
    },
  };
}

function buildReason(question: string, source: CreatorSource): string {
  const tokens = tokenize(question);
  const matchingTags = source.tags.filter((tag) => tokens.includes(tag));
  if (matchingTags.length > 0) {
    return `Matched ${matchingTags.join(", ")} in the source registry.`;
  }
  return "Selected by semantic overlap with the question and payment policy.";
}

function buildAnswer(
  question: string,
  selectedSources: CreatorSource[],
  sourceContent: Map<string, SourceContent> = new Map(),
): string {
  const sourceSentences = selectedSources
    .map((source) => {
      const content = sourceContent.get(source.id);
      return `${source.creator}: ${content?.paidExcerpt ?? source.summary}`;
    })
    .join(" ");

  return [
    `The paying agent treated "${question}" as a source-backed answer, not a free scrape.`,
    sourceSentences,
    "It bought the minimum useful bundle of sources, paid each cited creator in USDC atomic units, and wrote a receipt chain that ties the answer to the citations that earned.",
  ].join(" ");
}

function deterministicSteps(
  selectedSources: CreatorSource[],
  budget: AgentBudget,
  totalAtomicUsdc: number,
): AgentStep[] {
  const plural = (count: number) => (count === 1 ? "" : "s");
  return [
    {
      index: 0,
      name: "appraise",
      summary: `Ranked ${budget.candidateCount} candidate source${plural(
        budget.candidateCount,
      )} by keyword relevance.`,
      detail:
        "Deterministic scoring weighted exact term matches, tag hits, and price per source.",
    },
    {
      index: 1,
      name: "allocate",
      summary: `Bought ${selectedSources.length} source${plural(
        selectedSources.length,
      )} inside the source budget.`,
      detail:
        selectedSources.map((source) => source.title).join(", ") ||
        "No candidate cleared the budget policy.",
      spentAtomicUsdc: totalAtomicUsdc,
    },
    {
      index: 2,
      name: "draft",
      summary: "Grounded the answer in the purchased source summaries.",
      detail:
        "Each cited creator was paid in USDC atomic units and written into the receipt chain.",
    },
  ];
}

export function createQueryRecord(
  question: string,
  createdAt: string,
  sources: CreatorSource[] = DEFAULT_CREATOR_SOURCES,
  readerPayment?: QueryPaymentEvidence,
): QueryRecord {
  const citationMarket = planCitationMarket(question, sources);
  const selectedSources = citationMarket.selectedSources;
  const contentBySourceId = new Map(
    selectedSources.map((source) => [
      source.id,
      buildSourceContent(source, createdAt),
    ]),
  );
  const citations: Citation[] = selectedSources.map((source) => {
    const content = contentBySourceId.get(source.id);
    return {
      sourceId: source.id,
      title: source.title,
      creator: source.creator,
      handle: source.handle,
      wallet: source.wallet,
      url: source.url,
      amountAtomicUsdc: source.priceAtomicUsdc,
      reason: buildReason(question, source),
      canonicalUrl: content?.canonicalUrl,
      previewExcerpt: content?.previewExcerpt,
      paidExcerpt: content?.paidExcerpt,
      sourceContentHash: content?.contentHash,
      sourceExcerptHash: content?.excerptHash,
      contentFetchedAt: content?.fetchedAt,
      sourceKind: source.sourceKind,
      creatorKind: source.creatorKind,
      verifiedCreator: source.verifiedCreator,
      ownershipProof: source.ownershipProof,
    };
  });
  const answer = buildAnswer(question, selectedSources, contentBySourceId);
  const totalAtomicUsdc = citations.reduce(
    (sum, citation) => sum + citation.amountAtomicUsdc,
    0,
  );
  const agentSteps = deterministicSteps(
    selectedSources,
    citationMarket.budget,
    totalAtomicUsdc,
  );
  const traceHash = sha256Hex(agentSteps);
  const queryHash = sha256Hex({
    question,
    citations,
    sourceDecisions: citationMarket.decisions,
    agentBudget: citationMarket.budget,
    readerPaymentHash: readerPayment?.paymentHash,
  });
  const answerHash = sha256Hex({
    answer,
    citations,
    sourceDecisions: citationMarket.decisions,
    agentBudget: citationMarket.budget,
    traceHash,
    readerPaymentHash: readerPayment?.paymentHash,
  });
  const id = sha256Hex({ createdAt, question, queryHash }).slice(0, 18);

  return {
    id,
    question,
    answer,
    queryHash,
    answerHash,
    totalAtomicUsdc,
    citations,
    agentMode: "deterministic",
    agentRationale:
      "Deterministic keyword scoring selected sources by relevance and source budget.",
    sourceDecisions: citationMarket.decisions,
    agentBudget: citationMarket.budget,
    agentSteps,
    traceHash,
    receiptHashes: [],
    readerPayment,
    createdAt,
  };
}

export function createSourceAccessRecord(
  source: CreatorSource,
  createdAt: string,
): QueryRecord {
  const question = `Paid source access: ${source.title}`;
  const content = buildSourceContent(source, createdAt);
  const citation: Citation = {
    sourceId: source.id,
    title: source.title,
    creator: source.creator,
    handle: source.handle,
    wallet: source.wallet,
    url: source.url,
    amountAtomicUsdc: source.priceAtomicUsdc,
    reason: "Direct x402 source purchase.",
    canonicalUrl: content.canonicalUrl,
    previewExcerpt: content.previewExcerpt,
    paidExcerpt: content.paidExcerpt,
    sourceContentHash: content.contentHash,
    sourceExcerptHash: content.excerptHash,
    contentFetchedAt: content.fetchedAt,
    sourceKind: source.sourceKind,
    creatorKind: source.creatorKind,
    verifiedCreator: source.verifiedCreator,
    ownershipProof: source.ownershipProof,
  };
  const answer = `The agent paid ${source.creator} for direct access to "${source.title}", consumed excerpt hash ${content.excerptHash}, and wrote the purchase into the public attribution ledger.`;
  const queryHash = sha256Hex({ question, citations: [citation] });
  const answerHash = sha256Hex({ answer, citations: [citation] });
  const id = sha256Hex({ createdAt, question, queryHash }).slice(0, 18);

  return {
    id,
    question,
    answer,
    queryHash,
    answerHash,
    totalAtomicUsdc: source.priceAtomicUsdc,
    citations: [citation],
    receiptHashes: [],
    createdAt,
  };
}
