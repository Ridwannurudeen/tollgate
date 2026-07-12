import { NO_SOURCE_ANSWER } from "./engine";
import { sha256Hex } from "./hash";
import { buildSourceContent } from "./source-content";
import type { ChatMessage } from "./agent";
import type {
  ClaimSupport,
  ContributionCounterfactual,
  ContributionProof,
  ContributionScore,
  CreatorSource,
} from "./types";

export type ClaimLlm = (messages: ChatMessage[]) => Promise<string>;

const MAX_CLAIMS = 16;
const MAX_CLAIM_LENGTH = 320;
const MAX_SPAN_LENGTH = 600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maxLength)
    : "";
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("Claim LLM did not return JSON.");
    return JSON.parse(text.slice(start, end + 1));
  }
}

function claimMessages(answer: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a claim extractor. Decompose the answer into atomic factual claims. Every returned claim must be an exact verbatim substring of the answer. Return strict JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        answer,
        responseShape: { claims: ["verbatim claim from the answer"] },
      }),
    },
  ];
}

function verificationMessages(
  claims: string[],
  sources: CreatorSource[],
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a citation verifier. For each claim, select one source and quote an exact supporting span from that source's stored content. Never paraphrase a span. If no source supports a claim, return sourceId and span as null. Return strict JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        claims,
        sources: sources.map((source) => ({
          sourceId: source.id,
          title: source.title,
          storedContent: buildSourceContent(source, "claim-verification")
            .paidExcerpt,
        })),
        responseShape: {
          supports: [
            { claim: "string", sourceId: "string|null", span: "string|null" },
          ],
        },
      }),
    },
  ];
}

function parseExtractedClaims(text: string): string[] {
  const parsed = parseJsonObject(text);
  const rawClaims = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.claims)
      ? parsed.claims
      : [];
  return Array.from(
    new Set(
      rawClaims
        .map((item) =>
          typeof item === "string"
            ? clean(item, MAX_CLAIM_LENGTH)
            : isRecord(item)
              ? clean(item.claim ?? item.text, MAX_CLAIM_LENGTH)
              : "",
        )
        .filter(Boolean)
        .slice(0, MAX_CLAIMS),
    ),
  );
}

function sentenceClaims(answer: string): string[] {
  return (answer.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [])
    .map((sentence) => clean(sentence, MAX_CLAIM_LENGTH))
    .filter(Boolean);
}

export async function extractClaims(
  answer: string,
  llm: ClaimLlm,
): Promise<string[]> {
  const normalizedAnswer = clean(answer, 1_600);
  if (!normalizedAnswer) return [];
  const claims = parseExtractedClaims(await llm(claimMessages(normalizedAnswer)));
  const exactClaims = claims.filter((claim) => normalizedAnswer.includes(claim));
  const uncoveredSentences = sentenceClaims(normalizedAnswer).filter(
    (sentence) => !exactClaims.some((claim) => sentence.includes(claim)),
  );
  const coveredClaims = Array.from(
    new Set([...exactClaims, ...uncoveredSentences]),
  );
  return coveredClaims.length > 0 && coveredClaims.length <= MAX_CLAIMS
    ? coveredClaims
    : [normalizedAnswer];
}

function parseVerificationRows(text: string): unknown[] | null {
  const parsed = parseJsonObject(text);
  if (Array.isArray(parsed)) return parsed;
  if (isRecord(parsed) && Array.isArray(parsed.supports)) {
    return parsed.supports;
  }
  return null;
}

export async function verifyClaims(
  claims: string[],
  sources: CreatorSource[],
  verifierLlm: ClaimLlm,
): Promise<ClaimSupport[]> {
  if (claims.length === 0) return [];
  let rows: unknown[] | null;
  try {
    rows = parseVerificationRows(
      await verifierLlm(verificationMessages(claims, sources)),
    );
  } catch {
    return claims.map((claim) => ({
      claim,
      sourceId: null,
      span: null,
      status: "unable-to-verify" as const,
    }));
  }
  if (!rows) {
    return claims.map((claim) => ({
      claim,
      sourceId: null,
      span: null,
      status: "unable-to-verify" as const,
    }));
  }

  const sourceContentById = new Map(
    sources.map((source) => [
      source.id,
      buildSourceContent(source, "claim-verification").paidExcerpt,
    ]),
  );
  return claims.map((claim, index) => {
    const row = rows?.find((candidate) => {
      if (!isRecord(candidate)) return false;
      const rowClaim = clean(candidate.claim, MAX_CLAIM_LENGTH);
      return rowClaim === claim;
    }) ?? rows?.[index];
    if (!isRecord(row)) {
      return {
        claim,
        sourceId: null,
        span: null,
        status: "unable-to-verify" as const,
      };
    }
    const sourceId = clean(row.sourceId, 120);
    const span = clean(row.span, MAX_SPAN_LENGTH);
    const sourceContent = sourceContentById.get(sourceId);
    if (!sourceId || !span || !sourceContent) {
      return {
        claim,
        sourceId: null,
        span: null,
        status: "unsupported" as const,
      };
    }
    if (!sourceContent.includes(span)) {
      return {
        claim,
        sourceId: null,
        span: null,
        status: "unsupported" as const,
      };
    }
    return {
      claim,
      sourceId,
      span,
      status: "supported" as const,
    };
  });
}

export function allocatePool(
  sourceIds: string[],
  weights: Map<string, number>,
  poolAtomicUsdc: number,
  positiveWeightRemainderOnly = false,
): Map<string, number> {
  const totalWeight = sourceIds.reduce(
    (sum, sourceId) => sum + Math.max(0, weights.get(sourceId) ?? 0),
    0,
  );
  const rewards = new Map<string, number>();
  if (sourceIds.length === 0 || totalWeight <= 0 || poolAtomicUsdc <= 0) {
    return rewards;
  }
  let allocated = 0;
  for (const sourceId of sourceIds) {
    const reward = Math.floor(
      (poolAtomicUsdc * Math.max(0, weights.get(sourceId) ?? 0)) /
        totalWeight,
    );
    rewards.set(sourceId, reward);
    allocated += reward;
  }
  let remainder = poolAtomicUsdc - allocated;
  const remainderSourceIds = positiveWeightRemainderOnly
    ? sourceIds.filter((sourceId) => (weights.get(sourceId) ?? 0) > 0)
    : sourceIds;
  for (const sourceId of remainderSourceIds) {
    if (remainder <= 0) break;
    rewards.set(sourceId, (rewards.get(sourceId) ?? 0) + 1);
    remainder -= 1;
  }
  return rewards;
}

function allocateContributionScores(
  sourceIds: string[],
  marginal: Map<string, number>,
  poolAtomicUsdc: number,
  fallbackAmounts: Record<string, number>,
  positiveWeightRemainderOnly = false,
): ContributionScore[] {
  const hasPositiveContribution = sourceIds.some(
    (sourceId) => (marginal.get(sourceId) ?? 0) > 0,
  );
  const weights = hasPositiveContribution
    ? marginal
    : new Map(
        sourceIds.map((sourceId) => [
          sourceId,
          Math.max(0, fallbackAmounts[sourceId] ?? 0) || 1,
        ]),
      );
  const rewards = allocatePool(
    sourceIds,
    weights,
    Math.max(0, Math.floor(poolAtomicUsdc)),
    positiveWeightRemainderOnly,
  );
  return sourceIds.map((sourceId) => ({
    sourceId,
    marginalContribution: Math.max(0, marginal.get(sourceId) ?? 0),
    rewardAtomicUsdc: rewards.get(sourceId) ?? 0,
    fallback: !hasPositiveContribution,
  }));
}

export function scoreContribution(
  claimSupport: ClaimSupport[],
  poolAtomicUsdc = 0,
  fallbackAmounts: Record<string, number> = {},
): ContributionScore[] {
  const sourceIds = Array.from(
    new Set([
      ...Object.keys(fallbackAmounts),
      ...claimSupport.flatMap((support) =>
        support.sourceId ? [support.sourceId] : [],
      ),
    ]),
  );
  const supported = claimSupport.filter(
    (support) => support.status === "supported" && support.sourceId,
  );
  const supportedCount = supported.length;
  const marginal = new Map(
    sourceIds.map((sourceId) => [
      sourceId,
      supportedCount -
        supported.filter((support) => support.sourceId !== sourceId).length,
    ]),
  );
  return allocateContributionScores(
    sourceIds,
    marginal,
    poolAtomicUsdc,
    fallbackAmounts,
  );
}

function supportedCount(claimSupport: ClaimSupport[]): number {
  return claimSupport.filter((support) => support.status === "supported")
    .length;
}

function isValidEvidenceRow(
  value: unknown,
  purchasedSourceIds: Set<string>,
  omittedSourceId?: string,
): value is ClaimSupport {
  if (!value || typeof value !== "object") return false;
  const support = value as Partial<ClaimSupport>;
  if (typeof support.claim !== "string") return false;
  if (support.status === "supported") {
    return (
      typeof support.sourceId === "string" &&
      purchasedSourceIds.has(support.sourceId) &&
      support.sourceId !== omittedSourceId &&
      typeof support.span === "string" &&
      support.span.length > 0
    );
  }
  return (
    (support.status === "unsupported" ||
      support.status === "unable-to-verify") &&
    support.sourceId === null &&
    support.span === null
  );
}

function assertLeaveOneOutProof(
  baseline: ClaimSupport[],
  proof: ContributionProof,
  expectedPurchasedSourceIds: string[],
  eligibleSourceIds: string[],
): void {
  if (!proof || proof.method !== "leave-one-out-v1") {
    throw new Error("Unsupported contribution proof method.");
  }
  if (
    expectedPurchasedSourceIds.length < 1 ||
    expectedPurchasedSourceIds.length > 3 ||
    new Set(expectedPurchasedSourceIds).size !==
      expectedPurchasedSourceIds.length
  ) {
    throw new Error(
      "Leave-one-out contribution scoring requires 1 to 3 sources.",
    );
  }
  const expectedPurchasedSourceSet = new Set(expectedPurchasedSourceIds);
  if (
    !Array.isArray(baseline) ||
    !Array.isArray(proof.purchasedSourceIds) ||
    !Array.isArray(proof.eligibleSourceIds) ||
    !Array.isArray(proof.counterfactuals) ||
    proof.purchasedSourceIds.length !== expectedPurchasedSourceIds.length ||
    new Set(proof.purchasedSourceIds).size !==
      proof.purchasedSourceIds.length ||
    proof.purchasedSourceIds.some(
      (sourceId) => !expectedPurchasedSourceSet.has(sourceId),
    ) ||
    proof.eligibleSourceIds.length !== eligibleSourceIds.length ||
    proof.eligibleSourceIds.some(
      (sourceId, index) => sourceId !== eligibleSourceIds[index],
    ) ||
    eligibleSourceIds.some(
      (sourceId) => !proof.purchasedSourceIds.includes(sourceId),
    ) ||
    proof.counterfactuals.length !== proof.purchasedSourceIds.length ||
    proof.counterfactuals.some(
      (counterfactual, index) =>
        !counterfactual ||
        counterfactual.omittedSourceId !== proof.purchasedSourceIds[index] ||
        !Array.isArray(counterfactual.claimSupport),
    )
  ) {
    throw new Error(
      "Leave-one-out contribution proof has invalid source coverage.",
    );
  }
  const purchasedSourceSet = new Set(proof.purchasedSourceIds);
  if (
    baseline.some((support) => !isValidEvidenceRow(support, purchasedSourceSet))
  ) {
    throw new Error(
      "Leave-one-out contribution proof has invalid baseline evidence.",
    );
  }
  for (const counterfactual of proof.counterfactuals) {
    if (
      counterfactual.claimSupport.length !== baseline.length ||
      counterfactual.claimSupport.some(
        (support, index) =>
          !isValidEvidenceRow(
            support,
            purchasedSourceSet,
            counterfactual.omittedSourceId,
          ) || support.claim !== baseline[index]?.claim,
      )
    ) {
      throw new Error(
        "Leave-one-out contribution proof does not match the baseline claims.",
      );
    }
  }
}

export function scoreContributionFromProof(
  baseline: ClaimSupport[],
  proof: ContributionProof,
  poolAtomicUsdc: number,
  fallbackAmounts: Record<string, number>,
  purchasedSourceIds: string[],
): ContributionScore[] {
  const eligibleSourceIds = Object.keys(fallbackAmounts);
  assertLeaveOneOutProof(
    baseline,
    proof,
    purchasedSourceIds,
    eligibleSourceIds,
  );
  const hasUnableEvidence =
    baseline.some((support) => support.status === "unable-to-verify") ||
    proof.counterfactuals.some((counterfactual) =>
      counterfactual.claimSupport.some(
        (support) => support.status === "unable-to-verify",
      ),
    );
  const baselineQuality = supportedCount(baseline);
  const marginal = hasUnableEvidence
    ? new Map(eligibleSourceIds.map((sourceId) => [sourceId, 0]))
    : new Map(
        proof.counterfactuals.map((counterfactual) => [
          counterfactual.omittedSourceId,
          baselineQuality - supportedCount(counterfactual.claimSupport),
        ]),
      );
  return allocateContributionScores(
    eligibleSourceIds,
    marginal,
    poolAtomicUsdc,
    fallbackAmounts,
    true,
  );
}

export async function scoreContributionLeaveOneOut(
  claims: string[],
  purchasedSources: CreatorSource[],
  verifierLlm: ClaimLlm,
  baseline: ClaimSupport[],
  poolAtomicUsdc: number,
  fallbackAmounts: Record<string, number>,
): Promise<{
  contributionScores: ContributionScore[];
  contributionProof: ContributionProof;
}> {
  if (purchasedSources.length < 1 || purchasedSources.length > 3) {
    throw new Error(
      "Leave-one-out contribution scoring requires 1 to 3 sources.",
    );
  }
  const purchasedSourceIds = purchasedSources.map((source) => source.id);
  const eligibleSourceIds = Object.keys(fallbackAmounts);
  if (
    new Set(purchasedSourceIds).size !== purchasedSourceIds.length ||
    eligibleSourceIds.some((sourceId) => !purchasedSourceIds.includes(sourceId))
  ) {
    throw new Error(
      "Leave-one-out contribution proof has invalid source coverage.",
    );
  }
  const counterfactuals: ContributionCounterfactual[] = await Promise.all(
    purchasedSources.map(async (omittedSource) => ({
      omittedSourceId: omittedSource.id,
      claimSupport: await verifyClaims(
        claims,
        purchasedSources.filter((source) => source.id !== omittedSource.id),
        verifierLlm,
      ),
    })),
  );
  const contributionProof: ContributionProof = {
    method: "leave-one-out-v1",
    purchasedSourceIds,
    eligibleSourceIds,
    counterfactuals,
  };
  return {
    contributionScores: scoreContributionFromProof(
      baseline,
      contributionProof,
      poolAtomicUsdc,
      fallbackAmounts,
      purchasedSourceIds,
    ),
    contributionProof,
  };
}

export function removeUnsupportedClaims(
  answer: string,
  claimSupport: ClaimSupport[],
): string {
  let sanitized = answer;
  let hadUnremovableClaim = false;
  for (const support of claimSupport) {
    if (support.status === "supported") continue;
    if (support.claim && sanitized.includes(support.claim)) {
      sanitized = sanitized.split(support.claim).join(" ");
    } else {
      hadUnremovableClaim = true;
    }
  }
  const normalized = sanitized.replace(/\s+/g, " ").trim();
  return hadUnremovableClaim || normalized.length < 40
    ? NO_SOURCE_ANSWER
    : normalized;
}

export function claimSupportRoot(
  claimSupport: ClaimSupport[],
  contributionProof?: ContributionProof,
): string {
  return contributionProof
    ? sha256Hex({
        method: contributionProof.method,
        baselineClaimSupport: claimSupport,
        purchasedSourceIds: contributionProof.purchasedSourceIds,
        eligibleSourceIds: contributionProof.eligibleSourceIds,
        counterfactuals: contributionProof.counterfactuals,
      })
    : sha256Hex(claimSupport);
}
