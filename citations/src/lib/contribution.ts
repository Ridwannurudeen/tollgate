import { NO_SOURCE_ANSWER } from "./engine";
import { sha256Hex } from "./hash";
import {
  completeAndParseWithLlm,
  parseJsonObject,
} from "./json-parse";
import { buildSourceContent } from "./source-content";
import type { ChatMessage } from "./agent";
import type {
  ClaimSupport,
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
  const claims = await completeAndParseWithLlm(
    claimMessages(normalizedAnswer),
    llm,
    parseExtractedClaims,
  );
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
    rows = await completeAndParseWithLlm(
      verificationMessages(claims, sources),
      verifierLlm,
      parseVerificationRows,
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

function allocatePool(
  sourceIds: string[],
  weights: Map<string, number>,
  poolAtomicUsdc: number,
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
  for (const sourceId of sourceIds) {
    if (remainder <= 0) break;
    rewards.set(sourceId, (rewards.get(sourceId) ?? 0) + 1);
    remainder -= 1;
  }
  return rewards;
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
  );
  return sourceIds.map((sourceId) => ({
    sourceId,
    marginalContribution: Math.max(0, marginal.get(sourceId) ?? 0),
    rewardAtomicUsdc: rewards.get(sourceId) ?? 0,
    fallback: !hasPositiveContribution,
  }));
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

export function claimSupportRoot(claimSupport: ClaimSupport[]): string {
  return sha256Hex(claimSupport);
}
