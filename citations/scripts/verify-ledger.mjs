import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readLedger } from "./ledger-store.mjs";

const ZERO_HASH = `0x${"0".repeat(64)}`;
const appDir = fileURLToPath(new URL("..", import.meta.url));

function stableStringify(value) {
  if (value === undefined) return "null";

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256Hex(value) {
  return `0x${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function legacyStableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => legacyStableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${legacyStableStringify(value[key])}`,
      )
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function legacySha256Hex(value) {
  return `0x${createHash("sha256").update(legacyStableStringify(value)).digest("hex")}`;
}

function receiptPayload(receipt, includeUndefinedOptionals) {
  const payload = {
    queryId: receipt.queryId,
    sourceId: receipt.sourceId,
    creator: receipt.creator,
    wallet: receipt.wallet,
    amountAtomicUsdc: receipt.amountAtomicUsdc,
    settlementMode: receipt.settlementMode,
    previousHash: receipt.previousHash,
    createdAt: receipt.createdAt,
  };
  if (receipt.queryPaymentHash !== undefined) {
    payload.queryPaymentHash = receipt.queryPaymentHash;
  }
  if (includeUndefinedOptionals || receipt.payer !== undefined) {
    payload.payer = receipt.payer;
  }
  if (includeUndefinedOptionals || receipt.transaction !== undefined) {
    payload.transaction = receipt.transaction;
  }
  if (includeUndefinedOptionals || receipt.paymentResource !== undefined) {
    payload.paymentResource = receipt.paymentResource;
  }
  if (receipt.feeRouterSplitId !== undefined) {
    payload.feeRouterSplitId = receipt.feeRouterSplitId;
  }
  if (receipt.feeRouterCreateSplitTx !== undefined) {
    payload.feeRouterCreateSplitTx = receipt.feeRouterCreateSplitTx;
  }
  if (receipt.feeRouterPayTx !== undefined) {
    payload.feeRouterPayTx = receipt.feeRouterPayTx;
  }
  if (receipt.canonicalUrl !== undefined) {
    payload.canonicalUrl = receipt.canonicalUrl;
  }
  if (receipt.sourceContentHash !== undefined) {
    payload.sourceContentHash = receipt.sourceContentHash;
  }
  if (receipt.sourceExcerptHash !== undefined) {
    payload.sourceExcerptHash = receipt.sourceExcerptHash;
  }
  if (receipt.contentFetchedAt !== undefined) {
    payload.contentFetchedAt = receipt.contentFetchedAt;
  }
  if (receipt.ownershipProof !== undefined) {
    payload.ownershipProof = receipt.ownershipProof;
  }
  if (receipt.payoutPolicy !== undefined) {
    payload.payoutPolicy = receipt.payoutPolicy;
  }
  if (receipt.contributors !== undefined) {
    payload.contributors = receipt.contributors;
  }
  if (receipt.releasedReceiptHashes !== undefined) {
    payload.releasedReceiptHashes = receipt.releasedReceiptHashes;
  }
  if (receipt.refundReason !== undefined) {
    payload.refundReason = receipt.refundReason;
  }
  return payload;
}

function legacyX402SourceAccessReceiptPayload(receipt) {
  return {
    queryId: receipt.queryId,
    sourceId: receipt.sourceId,
    creator: receipt.creator,
    wallet: receipt.wallet,
    amountAtomicUsdc: receipt.amountAtomicUsdc,
    settlementMode: receipt.settlementMode,
    payer: receipt.payer,
    transaction: receipt.transaction,
    paymentResource: receipt.paymentResource,
    previousHash: receipt.previousHash,
    createdAt: receipt.createdAt,
  };
}

function receiptHashCandidates(receipt) {
  return [
    sha256Hex(receiptPayload(receipt, false)),
    sha256Hex(receiptPayload(receipt, true)),
    legacySha256Hex(legacyX402SourceAccessReceiptPayload(receipt)),
  ];
}

function queryPaymentPayload(query, includeUndefinedOptionals) {
  if (!query.readerPayment) return null;
  const payload = {
    amountAtomicUsdc: query.readerPayment.amountAtomicUsdc,
    settlementMode: query.readerPayment.settlementMode,
    payTo: query.readerPayment.payTo,
    paymentResource: query.readerPayment.paymentResource,
  };
  if (includeUndefinedOptionals || query.readerPayment.payer !== undefined) {
    payload.payer = query.readerPayment.payer;
  }
  if (
    includeUndefinedOptionals ||
    query.readerPayment.transaction !== undefined
  ) {
    payload.transaction = query.readerPayment.transaction;
  }
  return payload;
}

function legacyQueryPaymentPayload(query) {
  if (!query.readerPayment) return null;
  return {
    amountAtomicUsdc: query.readerPayment.amountAtomicUsdc,
    settlementMode: query.readerPayment.settlementMode,
    payTo: query.readerPayment.payTo,
    paymentResource: query.readerPayment.paymentResource,
    payer: query.readerPayment.payer,
    transaction: query.readerPayment.transaction,
  };
}

function queryPaymentHashCandidates(query) {
  if (!query.readerPayment) return [];
  return [
    sha256Hex(queryPaymentPayload(query, false)),
    sha256Hex(queryPaymentPayload(query, true)),
    legacySha256Hex(legacyQueryPaymentPayload(query)),
  ];
}

function traceHashCandidates(query) {
  if (!query.traceHash || !query.agentSteps) return [];
  if (query.agentMode === "llm") {
    // Legacy LLM records (pre model-binding) lack agentModel and hashed the
    // bare step list.
    if (!query.agentModel) return [sha256Hex(query.agentSteps)];
    return [
      sha256Hex({
        model: query.agentModel,
        steps: query.agentSteps,
        sourceDecisions: query.sourceDecisions,
      }),
      sha256Hex({ model: query.agentModel, steps: query.agentSteps }),
      sha256Hex(query.agentSteps),
    ];
  }
  return [
    sha256Hex({
      agentSteps: query.agentSteps,
      sourceDecisions: query.sourceDecisions,
    }),
    sha256Hex(query.agentSteps),
  ];
}

function allocatePool(
  sourceIds,
  weights,
  poolAtomicUsdc,
  positiveWeightRemainderOnly = false,
) {
  const totalWeight = sourceIds.reduce(
    (sum, sourceId) => sum + Math.max(0, weights.get(sourceId) ?? 0),
    0,
  );
  const rewards = new Map();
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

function scoreContribution(claimSupport, poolAtomicUsdc, fallbackAmounts) {
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
  const marginal = new Map(
    sourceIds.map((sourceId) => [
      sourceId,
      supported.length -
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
  const rewards = allocatePool(sourceIds, weights, Math.max(0, poolAtomicUsdc));
  return sourceIds.map((sourceId) => ({
    sourceId,
    marginalContribution: Math.max(0, marginal.get(sourceId) ?? 0),
    rewardAtomicUsdc: rewards.get(sourceId) ?? 0,
    fallback: !hasPositiveContribution,
  }));
}

function supportedCount(claimSupport) {
  return claimSupport.filter((support) => support.status === "supported")
    .length;
}

function isValidEvidenceRow(value, purchasedSourceIds, omittedSourceId) {
  if (!value || typeof value !== "object" || typeof value.claim !== "string") {
    return false;
  }
  if (value.status === "supported") {
    return (
      typeof value.sourceId === "string" &&
      purchasedSourceIds.has(value.sourceId) &&
      value.sourceId !== omittedSourceId &&
      typeof value.span === "string" &&
      value.span.length > 0
    );
  }
  return (
    (value.status === "unsupported" || value.status === "unable-to-verify") &&
    value.sourceId === null &&
    value.span === null
  );
}

function assertLeaveOneOutProof(
  baseline,
  proof,
  expectedPurchasedSourceIds,
  eligibleSourceIds,
) {
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
        counterfactual?.omittedSourceId !== proof.purchasedSourceIds[index] ||
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

function scoreContributionFromProof(
  baseline,
  proof,
  poolAtomicUsdc,
  fallbackAmounts,
  purchasedSourceIds,
) {
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
  const hasPositiveContribution = eligibleSourceIds.some(
    (sourceId) => (marginal.get(sourceId) ?? 0) > 0,
  );
  const weights = hasPositiveContribution
    ? marginal
    : new Map(
        eligibleSourceIds.map((sourceId) => [
          sourceId,
          Math.max(0, fallbackAmounts[sourceId] ?? 0) || 1,
        ]),
      );
  const rewards = allocatePool(
    eligibleSourceIds,
    weights,
    Math.max(0, Math.floor(poolAtomicUsdc)),
    true,
  );
  return eligibleSourceIds.map((sourceId) => ({
    sourceId,
    marginalContribution: Math.max(0, marginal.get(sourceId) ?? 0),
    rewardAtomicUsdc: rewards.get(sourceId) ?? 0,
    fallback: !hasPositiveContribution,
  }));
}

function claimSupportRoot(claimSupport, contributionProof) {
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

export function verifyLedger(ledger) {
  const issues = [];
  const receiptHashes = new Set(
    ledger.receipts.map((receipt) => receipt.receiptHash),
  );
  const queryIds = new Set(ledger.queries.map((query) => query.id));
  let expectedPreviousHash = ZERO_HASH;

  ledger.receipts.forEach((receipt, index) => {
    if (receipt.previousHash !== expectedPreviousHash) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "previousHash does not match prior receipt",
      });
    }

    if (!receiptHashCandidates(receipt).includes(receipt.receiptHash)) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "receiptHash does not match payload",
      });
    }

    if (!queryIds.has(receipt.queryId)) {
      issues.push({
        index,
        receiptHash: receipt.receiptHash,
        reason: "receipt references missing query",
      });
    }

    expectedPreviousHash = receipt.receiptHash;
  });

  ledger.queries.forEach((query) => {
    if (
      query.readerPayment &&
      !queryPaymentHashCandidates(query).includes(
        query.readerPayment.paymentHash,
      )
    ) {
      issues.push({
        index: -1,
        receiptHash: query.readerPayment.paymentHash,
        reason: `query ${query.id} has invalid reader payment hash`,
      });
    }

    if (
      query.traceHash &&
      !traceHashCandidates(query).includes(query.traceHash)
    ) {
      issues.push({
        index: -1,
        receiptHash: query.traceHash,
        reason: `query ${query.id} has invalid trace hash`,
      });
    }

    const hasContributionProof =
      query.claimSupport !== undefined ||
      query.contributionScores !== undefined ||
      query.contributionProof !== undefined ||
      query.claimSupportRoot !== undefined;
    if (hasContributionProof) {
      const rawContributionProof = query.contributionProof;
      const malformedContributionProof =
        rawContributionProof !== undefined &&
        (!rawContributionProof ||
          typeof rawContributionProof !== "object" ||
          Array.isArray(rawContributionProof));
      const contributionProof = malformedContributionProof
        ? undefined
        : query.contributionProof;
      if (malformedContributionProof) {
        issues.push({
          index: -1,
          reason: `query ${query.id} has invalid leave-one-out contribution proof: invalid proof shape`,
        });
      }
      if (!Array.isArray(query.claimSupport) || !query.claimSupportRoot) {
        issues.push({
          index: -1,
          reason: `query ${query.id} has incomplete claim-support evidence`,
        });
      } else if (
        !malformedContributionProof &&
        claimSupportRoot(query.claimSupport, contributionProof) !==
          query.claimSupportRoot
      ) {
        issues.push({
          index: -1,
          receiptHash: query.claimSupportRoot,
          reason: `query ${query.id} has invalid claim-support root`,
        });
      }

      if (
        !Array.isArray(query.claimSupport) ||
        !Array.isArray(query.contributionScores)
      ) {
        issues.push({
          index: -1,
          reason: `query ${query.id} has incomplete contribution scores`,
        });
      } else {
        let expectedScores = null;
        try {
          if (rawContributionProof !== undefined) {
            if (
              malformedContributionProof ||
              !contributionProof ||
              !Array.isArray(contributionProof.eligibleSourceIds)
            ) {
              throw new Error("invalid proof shape");
            }
            const eligibleSourceIds = new Set(
              contributionProof.eligibleSourceIds,
            );
            if (
              query.citations.some(
                (citation) =>
                  citation.payoutPolicy !== "refund-unused" &&
                  !eligibleSourceIds.has(citation.sourceId),
              )
            ) {
              throw new Error("proof omits a payout-eligible citation");
            }
            const citationBySourceId = new Map(
              query.citations.map((citation) => [citation.sourceId, citation]),
            );
            const fallbackAmounts = Object.fromEntries(
              contributionProof.eligibleSourceIds.flatMap((sourceId) => {
                const citation = citationBySourceId.get(sourceId);
                return citation ? [[sourceId, citation.amountAtomicUsdc]] : [];
              }),
            );
            const poolAtomicUsdc = Object.values(fallbackAmounts).reduce(
              (sum, amount) => sum + amount,
              0,
            );
            expectedScores = scoreContributionFromProof(
              query.claimSupport,
              contributionProof,
              poolAtomicUsdc,
              fallbackAmounts,
              query.citations.map((citation) => citation.sourceId),
            );
          } else {
            const scoredSourceIds = new Set(
              query.contributionScores.map((score) => score.sourceId),
            );
            const fallbackAmounts = Object.fromEntries(
              query.citations
                .filter((citation) => scoredSourceIds.has(citation.sourceId))
                .map((citation) => [
                  citation.sourceId,
                  citation.amountAtomicUsdc,
                ]),
            );
            const poolAtomicUsdc = Object.values(fallbackAmounts).reduce(
              (sum, amount) => sum + amount,
              0,
            );
            expectedScores = scoreContribution(
              query.claimSupport,
              poolAtomicUsdc,
              fallbackAmounts,
            );
          }
        } catch (error) {
          issues.push({
            index: -1,
            reason: `query ${query.id} has invalid leave-one-out contribution proof: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          });
        }
        if (
          expectedScores &&
          sha256Hex(expectedScores) !== sha256Hex(query.contributionScores)
        ) {
          issues.push({
            index: -1,
            reason: `query ${query.id} has contribution scores that do not match claim support`,
          });
        }
        for (const score of expectedScores ?? []) {
          const citation = query.citations.find(
            (candidate) => candidate.sourceId === score.sourceId,
          );
          if (!citation) {
            issues.push({
              index: -1,
              reason: `query ${query.id} has contribution score for missing citation`,
            });
            continue;
          }
          const shouldRefund = !score.fallback && score.rewardAtomicUsdc === 0;
          if (
            (shouldRefund && citation.payoutPolicy !== "refund-unused") ||
            (!shouldRefund &&
              (citation.payoutPolicy === "refund-unused" ||
                citation.payoutAtomicUsdc !== score.rewardAtomicUsdc))
          ) {
            issues.push({
              index: -1,
              reason: `query ${query.id} has citation payout that does not match contribution score`,
            });
          }
          const receipt = ledger.receipts.find(
            (candidate) =>
              candidate.queryId === query.id &&
              candidate.sourceId === citation.sourceId,
          );
          if (receipt) {
            const expectedAmount =
              receipt.settlementMode === "refunded"
                ? citation.amountAtomicUsdc
                : (citation.payoutAtomicUsdc ?? citation.amountAtomicUsdc);
            if (receipt.amountAtomicUsdc !== expectedAmount) {
              issues.push({
                index: -1,
                receiptHash: receipt.receiptHash,
                reason: `query ${query.id} has receipt amount that does not match contribution payout`,
              });
            }
          }
        }
      }
    }

    query.receiptHashes.forEach((receiptHash) => {
      if (!receiptHashes.has(receiptHash)) {
        issues.push({
          index: -1,
          receiptHash,
          reason: `query ${query.id} references missing receipt`,
        });
      }
    });
  });

  return {
    ok: issues.length === 0,
    queryCount: ledger.queries.length,
    receiptCount: ledger.receipts.length,
    latestHash: ledger.receipts.at(-1)?.receiptHash ?? ZERO_HASH,
    issues,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ledger = await readLedger(appDir);
  const result = verifyLedger(ledger);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}
