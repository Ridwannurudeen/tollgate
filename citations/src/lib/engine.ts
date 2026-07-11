import { DEFAULT_CREATOR_SOURCES } from "./catalog";
import { groundingYieldValue, type GroundingYieldMap } from "./grounding-yield";
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
export const NO_SOURCE_ANSWER =
  "Tollgate answers only from its registered creator network — it pays each cited creator, so it won't cite a source it can't pay. No registered creator covers this question, so the agent bought nothing and did not fabricate an answer. Try a question its creators cover (AI payments, x402, Arc, agent commerce, creator licensing), or register a source to expand the network.";

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

function rankSources(
  question: string,
  sources: CreatorSource[],
  groundingYields?: GroundingYieldMap,
) {
  const tokens = tokenize(question);
  const applyYields = groundingYields !== undefined;
  const ranked = sources
    .map((source, index) => {
      const score = scoreSource(tokens, source);
      const valuePerAtomicUsdc = score / source.priceAtomicUsdc;
      return {
        source,
        score,
        index,
        valuePerAtomicUsdc,
        adjustedValue: applyYields
          ? valuePerAtomicUsdc * groundingYieldValue(groundingYields, source.id)
          : valuePerAtomicUsdc,
      };
    })
    .sort((a, b) => {
      if (applyYields && b.adjustedValue !== a.adjustedValue) {
        return b.adjustedValue - a.adjustedValue;
      }
      return (
        b.score - a.score ||
        a.source.priceAtomicUsdc - b.source.priceAtomicUsdc ||
        a.index - b.index
      );
    });

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
  groundingYields?: GroundingYieldMap,
): {
  selectedSources: CreatorSource[];
  decisions: SourceDecision[];
  budget: AgentBudget;
} {
  const ranked = rankSources(question, sources, groundingYields);
  const selectedIds = new Set<string>();
  const selectedSources: CreatorSource[] = [];
  let remainingAtomicUsdc = sourceBudgetAtomicUsdc;
  let probationSelected = false;

  for (const item of ranked) {
    if (selectedSources.length >= limit) break;
    if (item.score <= 0) continue;
    if (item.source.priceAtomicUsdc > remainingAtomicUsdc) continue;
    if (item.source.probation && probationSelected) continue;
    selectedIds.add(item.source.id);
    selectedSources.push(item.source);
    remainingAtomicUsdc -= item.source.priceAtomicUsdc;
    if (item.source.probation) probationSelected = true;
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
        Math.round(item.adjustedValue * 1_000_000) / 1_000_000,
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
  if (selectedSources.length === 0) return NO_SOURCE_ANSWER;

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
  if (selectedSources.length === 0) {
    return [
      {
        index: 0,
        name: "appraise",
        summary: `Ranked ${budget.candidateCount} candidate source${plural(
          budget.candidateCount,
        )} by keyword relevance.`,
        detail:
          "Deterministic scoring found no useful overlap with the registered sources.",
      },
      {
        index: 1,
        name: "allocate",
        summary: "Bought 0 sources because no candidate was relevant enough.",
        detail: "No creator was paid; the source budget remained unused.",
        spentAtomicUsdc: totalAtomicUsdc,
      },
      {
        index: 2,
        name: "draft",
        summary: "Returned an honest no-source answer.",
        detail:
          "The agent did not fabricate a citation from irrelevant registered sources.",
      },
    ];
  }

  return [
    {
      index: 0,
      name: "appraise",
      summary: `Ranked ${budget.candidateCount} candidate source${plural(
        budget.candidateCount,
      )} by keyword relevance.`,
      detail:
        "Deterministic scoring weighted exact term matches, tag hits, price per source, and historical grounding yield.",
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
  groundingYields?: GroundingYieldMap,
): QueryRecord {
  const citationMarket = planCitationMarket(
    question,
    sources,
    3,
    DEFAULT_SOURCE_BUDGET_ATOMIC_USDC,
    groundingYields,
  );
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
      creatorClaimed: source.creatorClaimed,
      ownershipProof: source.ownershipProof,
      contributors: source.contributors,
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
  const traceHash = sha256Hex({
    agentSteps,
    sourceDecisions: citationMarket.decisions,
  });
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
      selectedSources.length === 0
        ? "Deterministic keyword scoring found no registered source relevant enough to cite, so the agent bought nothing."
        : "Deterministic keyword scoring selected sources by relevance and source budget.",
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
    creatorClaimed: source.creatorClaimed,
    ownershipProof: source.ownershipProof,
    contributors: source.contributors,
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
