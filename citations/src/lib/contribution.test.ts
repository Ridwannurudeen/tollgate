import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./agent";
import {
  extractClaims,
  claimSupportRoot,
  removeUnsupportedClaims,
  scoreContribution,
  scoreContributionFromProof,
  scoreContributionLeaveOneOut,
  verifyClaims,
} from "./contribution";
import { buildSourceContent } from "./source-content";
import { applyContributionProof } from "./settlement";
import { createQueryRecord } from "./engine";
import type { ClaimSupport, CreatorSource } from "./types";

const SOURCE: CreatorSource = {
  id: "source-a",
  title: "Stored Evidence",
  creator: "Evidence Lab",
  handle: "@evidence",
  wallet: "0x1111111111111111111111111111111111111111",
  url: "https://example.com/evidence",
  summary: "Stored evidence explains how citation receipts bind useful claims.",
  tags: ["citations", "receipts"],
  priceAtomicUsdc: 1_000,
  sourceKind: "internal-test",
  creatorKind: "internal-test",
  verifiedCreator: true,
  contentExcerpt: "Verified source content.",
};

const REDUNDANT_SOURCE: CreatorSource = {
  ...SOURCE,
  id: "source-b",
  title: "Redundant Stored Evidence",
  creator: "Redundant Lab",
  handle: "@redundant",
  wallet: "0x2222222222222222222222222222222222222222",
  url: "https://example.com/redundant",
};

const UNIQUE_SOURCE: CreatorSource = {
  ...SOURCE,
  id: "source-c",
  title: "Unique Stored Evidence",
  creator: "Unique Lab",
  handle: "@unique",
  wallet: "0x3333333333333333333333333333333333333333",
  url: "https://example.com/unique",
  contentExcerpt: "Unique evidence proves the second claim.",
};

describe("proof of useful citation", () => {
  it("requires verifier spans to literally appear in stored source content", async () => {
    const exactSpan = "Excerpt: Verified source content.";
    const supports = await verifyClaims(
      ["The receipt binds the claim."],
      [SOURCE],
      async () =>
        JSON.stringify({
          supports: [
            {
              claim: "The receipt binds the claim.",
              sourceId: SOURCE.id,
              span: exactSpan,
            },
          ],
        }),
    );
    expect(supports[0]).toEqual({
      claim: "The receipt binds the claim.",
      sourceId: SOURCE.id,
      span: exactSpan,
      status: "supported",
    });

    const fabricated = await verifyClaims(
      ["The receipt binds the claim."],
      [SOURCE],
      async () =>
        JSON.stringify({
          supports: [
            {
              claim: "The receipt binds the claim.",
              sourceId: SOURCE.id,
              span: "This span was fabricated by the verifier.",
            },
          ],
        }),
    );
    expect(fabricated[0]).toMatchObject({
      sourceId: null,
      span: null,
      status: "unsupported",
    });
  });

  it("extracts only exact answer substrings", async () => {
    const claims = await extractClaims(
      "The receipt chain binds each useful claim to a source record.",
      async () =>
        JSON.stringify({
          claims: [
            "The receipt chain binds each useful claim to a source record.",
            "A paraphrase that is not in the answer.",
          ],
        }),
    );
    expect(claims).toEqual([
      "The receipt chain binds each useful claim to a source record.",
    ]);
  });

  it("adds an omitted answer sentence so every sentence is verified", async () => {
    const first = "The receipt chain binds each useful claim to a source record.";
    const second = "Creator payouts remain tied to that public evidence trail.";
    const claims = await extractClaims(`${first} ${second}`, async () =>
      JSON.stringify({ claims: [first] }),
    );

    expect(claims).toEqual([first, second]);
  });

  it("removes unsupported claims from the final answer", () => {
    const support: ClaimSupport[] = [
      {
        claim: "The receipt chain binds each useful claim to a source record.",
        sourceId: "source-a",
        span: "stored span",
        status: "supported",
      },
      {
        claim: "This unsupported assertion must not survive the final answer.",
        sourceId: null,
        span: null,
        status: "unsupported",
      },
    ];
    const answer = removeUnsupportedClaims(
      `${support[0].claim} ${support[1].claim} ${support[1].claim}`,
      support,
    );
    expect(answer).toContain(support[0].claim);
    expect(answer).not.toContain(support[1].claim);
  });

  it("computes hand-checkable assigned-support rewards", () => {
    const support: ClaimSupport[] = [
      { claim: "A", sourceId: "source-a", span: "A", status: "supported" },
      { claim: "B", sourceId: "source-a", span: "B", status: "supported" },
      { claim: "C", sourceId: "source-b", span: "C", status: "supported" },
    ];
    const scores = scoreContribution(support, 100, {
      "source-a": 70,
      "source-b": 30,
    });

    expect(scores).toEqual([
      {
        sourceId: "source-a",
        marginalContribution: 2,
        rewardAtomicUsdc: 67,
        fallback: false,
      },
      {
        sourceId: "source-b",
        marginalContribution: 1,
        rewardAtomicUsdc: 33,
        fallback: false,
      },
    ]);
  });

  it("re-verifies source redundancy for true leave-one-out scores", async () => {
    const sharedClaim = "Stored evidence supports the shared claim.";
    const uniqueClaim = "Unique evidence supports the second claim.";
    const claims = [sharedClaim, uniqueClaim];
    const sources = [SOURCE, REDUNDANT_SOURCE, UNIQUE_SOURCE];
    let verifierCalls = 0;
    const verifier = async (messages: ChatMessage[]) => {
      verifierCalls += 1;
      const payload = JSON.parse(messages[1]?.content ?? "{}") as {
        claims: string[];
        sources: Array<{ sourceId: string }>;
      };
      const sourceIds = new Set(
        payload.sources.map((source) => source.sourceId),
      );
      const sharedSourceId = sourceIds.has(SOURCE.id)
        ? SOURCE.id
        : sourceIds.has(REDUNDANT_SOURCE.id)
          ? REDUNDANT_SOURCE.id
          : null;
      return JSON.stringify({
        supports: payload.claims.map((claim) => {
          if (claim === sharedClaim && sharedSourceId) {
            return {
              claim,
              sourceId: sharedSourceId,
              span: "Excerpt: Verified source content.",
            };
          }
          if (claim === uniqueClaim && sourceIds.has(UNIQUE_SOURCE.id)) {
            return {
              claim,
              sourceId: UNIQUE_SOURCE.id,
              span: "Excerpt: Unique evidence proves the second claim.",
            };
          }
          return { claim, sourceId: null, span: null };
        }),
      });
    };
    const baseline = await verifyClaims(claims, sources, verifier);
    const fallbackAmounts = {
      [SOURCE.id]: 100,
      [REDUNDANT_SOURCE.id]: 100,
      [UNIQUE_SOURCE.id]: 100,
    };
    const result = await scoreContributionLeaveOneOut(
      claims,
      sources,
      verifier,
      baseline,
      300,
      fallbackAmounts,
    );

    expect(scoreContribution(baseline, 300, fallbackAmounts)).toEqual([
      {
        sourceId: SOURCE.id,
        marginalContribution: 1,
        rewardAtomicUsdc: 150,
        fallback: false,
      },
      {
        sourceId: REDUNDANT_SOURCE.id,
        marginalContribution: 0,
        rewardAtomicUsdc: 0,
        fallback: false,
      },
      {
        sourceId: UNIQUE_SOURCE.id,
        marginalContribution: 1,
        rewardAtomicUsdc: 150,
        fallback: false,
      },
    ]);
    expect(result.contributionScores).toEqual([
      {
        sourceId: SOURCE.id,
        marginalContribution: 0,
        rewardAtomicUsdc: 0,
        fallback: false,
      },
      {
        sourceId: REDUNDANT_SOURCE.id,
        marginalContribution: 0,
        rewardAtomicUsdc: 0,
        fallback: false,
      },
      {
        sourceId: UNIQUE_SOURCE.id,
        marginalContribution: 1,
        rewardAtomicUsdc: 300,
        fallback: false,
      },
    ]);
    expect(
      result.contributionProof.counterfactuals.map(
        (counterfactual) => counterfactual.omittedSourceId,
      ),
    ).toEqual(sources.map((source) => source.id));
    expect(claimSupportRoot(baseline, result.contributionProof)).not.toBe(
      claimSupportRoot(baseline),
    );
    expect(verifierCalls).toBe(4);
  });

  it("does not emit a leave-one-out proof without a purchased source", async () => {
    const verifier = vi.fn(async () => "{}");

    await expect(
      scoreContributionLeaveOneOut([], [], verifier, [], 0, {}),
    ).rejects.toThrow("requires 1 to 3 sources");
    expect(verifier).not.toHaveBeenCalled();
  });

  it("falls back without inventing contribution when a counterfactual cannot be verified", async () => {
    const claim = "Stored evidence supports the claim.";
    const baseline: ClaimSupport[] = [
      {
        claim,
        sourceId: SOURCE.id,
        span: "Excerpt: Verified source content.",
        status: "supported",
      },
    ];

    const result = await scoreContributionLeaveOneOut(
      [claim],
      [SOURCE, REDUNDANT_SOURCE],
      async () => "not json",
      baseline,
      200,
      { [SOURCE.id]: 100, [REDUNDANT_SOURCE.id]: 100 },
    );

    expect(result.contributionScores).toEqual([
      {
        sourceId: SOURCE.id,
        marginalContribution: 0,
        rewardAtomicUsdc: 100,
        fallback: true,
      },
      {
        sourceId: REDUNDANT_SOURCE.id,
        marginalContribution: 0,
        rewardAtomicUsdc: 100,
        fallback: true,
      },
    ]);
    expect(
      result.contributionProof.counterfactuals.flatMap(
        (counterfactual) => counterfactual.claimSupport,
      ),
    ).toEqual([
      {
        claim,
        sourceId: null,
        span: null,
        status: "unable-to-verify",
      },
      {
        claim,
        sourceId: null,
        span: null,
        status: "unable-to-verify",
      },
    ]);
    expect(
      result.contributionScores.reduce(
        (sum, score) => sum + score.rewardAtomicUsdc,
        0,
      ),
    ).toBe(200);
  });

  it("keeps the explicit fallback split when every true marginal is zero", () => {
    const claim = "Either source independently supports this claim.";
    const baseline: ClaimSupport[] = [
      {
        claim,
        sourceId: SOURCE.id,
        span: "Excerpt: Verified source content.",
        status: "supported",
      },
    ];
    const scores = scoreContributionFromProof(
      baseline,
      {
        method: "leave-one-out-v1",
        purchasedSourceIds: [SOURCE.id, REDUNDANT_SOURCE.id],
        eligibleSourceIds: [SOURCE.id, REDUNDANT_SOURCE.id],
        counterfactuals: [
          {
            omittedSourceId: SOURCE.id,
            claimSupport: [
              {
                claim,
                sourceId: REDUNDANT_SOURCE.id,
                span: "Excerpt: Verified source content.",
                status: "supported",
              },
            ],
          },
          {
            omittedSourceId: REDUNDANT_SOURCE.id,
            claimSupport: [{ ...baseline[0] }],
          },
        ],
      },
      100,
      { [SOURCE.id]: 3, [REDUNDANT_SOURCE.id]: 1 },
      [SOURCE.id, REDUNDANT_SOURCE.id],
    );

    expect(scores).toEqual([
      {
        sourceId: SOURCE.id,
        marginalContribution: 0,
        rewardAtomicUsdc: 75,
        fallback: true,
      },
      {
        sourceId: REDUNDANT_SOURCE.id,
        marginalContribution: 0,
        rewardAtomicUsdc: 25,
        fallback: true,
      },
    ]);
  });

  it("gives rounding remainder only to a source with positive contribution", () => {
    const firstClaim = "The second source supports this claim.";
    const secondClaim = "The third source supports this claim.";
    const baseline: ClaimSupport[] = [
      {
        claim: firstClaim,
        sourceId: REDUNDANT_SOURCE.id,
        span: "Excerpt: Verified source content.",
        status: "supported",
      },
      {
        claim: secondClaim,
        sourceId: UNIQUE_SOURCE.id,
        span: "Excerpt: Unique evidence proves the second claim.",
        status: "supported",
      },
    ];
    const scores = scoreContributionFromProof(
      baseline,
      {
        method: "leave-one-out-v1",
        purchasedSourceIds: [SOURCE.id, REDUNDANT_SOURCE.id, UNIQUE_SOURCE.id],
        eligibleSourceIds: [SOURCE.id, REDUNDANT_SOURCE.id, UNIQUE_SOURCE.id],
        counterfactuals: [
          {
            omittedSourceId: SOURCE.id,
            claimSupport: baseline.map((support) => ({ ...support })),
          },
          {
            omittedSourceId: REDUNDANT_SOURCE.id,
            claimSupport: [
              {
                claim: firstClaim,
                sourceId: null,
                span: null,
                status: "unsupported",
              },
              { ...baseline[1] },
            ],
          },
          {
            omittedSourceId: UNIQUE_SOURCE.id,
            claimSupport: [
              { ...baseline[0] },
              {
                claim: secondClaim,
                sourceId: null,
                span: null,
                status: "unsupported",
              },
            ],
          },
        ],
      },
      1,
      { [SOURCE.id]: 1, [REDUNDANT_SOURCE.id]: 1, [UNIQUE_SOURCE.id]: 1 },
      [SOURCE.id, REDUNDANT_SOURCE.id, UNIQUE_SOURCE.id],
    );

    expect(scores).toEqual([
      {
        sourceId: SOURCE.id,
        marginalContribution: 0,
        rewardAtomicUsdc: 0,
        fallback: false,
      },
      {
        sourceId: REDUNDANT_SOURCE.id,
        marginalContribution: 1,
        rewardAtomicUsdc: 1,
        fallback: false,
      },
      {
        sourceId: UNIQUE_SOURCE.id,
        marginalContribution: 1,
        rewardAtomicUsdc: 0,
        fallback: false,
      },
    ]);
  });

  it("starts counterfactual checks concurrently and preserves source order", async () => {
    const claim = "Stored evidence supports the claim.";
    const sources = [SOURCE, REDUNDANT_SOURCE, UNIQUE_SOURCE];
    const started: string[] = [];
    const resolvers = new Map<string, (value: string) => void>();
    const verifier = (messages: ChatMessage[]) => {
      const payload = JSON.parse(messages[1]?.content ?? "{}") as {
        sources: Array<{ sourceId: string }>;
      };
      const presentSourceIds = new Set(
        payload.sources.map((source) => source.sourceId),
      );
      const omittedSource = sources.find(
        (source) => !presentSourceIds.has(source.id),
      );
      if (!omittedSource) throw new Error("missing omitted source");
      started.push(omittedSource.id);
      return new Promise<string>((resolve) => {
        resolvers.set(omittedSource.id, resolve);
      });
    };
    const pending = scoreContributionLeaveOneOut(
      [claim],
      sources,
      verifier,
      [
        {
          claim,
          sourceId: SOURCE.id,
          span: "Excerpt: Verified source content.",
          status: "supported",
        },
      ],
      2,
      { [SOURCE.id]: 1, [REDUNDANT_SOURCE.id]: 1 },
    );

    expect(started).toEqual(sources.map((source) => source.id));
    for (const source of sources.slice().reverse()) {
      const resolve = resolvers.get(source.id);
      if (!resolve) throw new Error(`missing resolver for ${source.id}`);
      resolve(
        JSON.stringify({
          supports: [{ claim, sourceId: null, span: null }],
        }),
      );
    }
    const result = await pending;

    expect(
      result.contributionProof.counterfactuals.map(
        (counterfactual) => counterfactual.omittedSourceId,
      ),
    ).toEqual(sources.map((source) => source.id));
    expect(result.contributionScores.map((score) => score.sourceId)).toEqual(
      sources.slice(0, 2).map((source) => source.id),
    );
  });

  it("falls back to the engine split when every marginal contribution is zero", () => {
    const scores = scoreContribution(
      [
        { claim: "A", sourceId: null, span: null, status: "unsupported" },
      ],
      100,
      { "source-a": 3, "source-b": 1 },
    );

    expect(scores).toEqual([
      {
        sourceId: "source-a",
        marginalContribution: 0,
        rewardAtomicUsdc: 75,
        fallback: true,
      },
      {
        sourceId: "source-b",
        marginalContribution: 0,
        rewardAtomicUsdc: 25,
        fallback: true,
      },
    ]);
  });

  it("wires claim support and contribution payouts into the settlement query", async () => {
    const previous = new Map(
      [
        "LEPTONWEB_LLM_API_KEY",
        "OPENAI_API_KEY",
        "LEPTONWEB_LLM_MODEL",
        "LEPTONWEB_LLM_BASE_URL",
        "LEPTONWEB_VERIFIER_MODEL",
        "LEPTONWEB_LEAVE_ONE_OUT_CONTRIBUTION",
      ].map((name) => [name, process.env[name]]),
    );
    process.env.LEPTONWEB_LLM_API_KEY = "test-key";
    delete process.env.OPENAI_API_KEY;
    process.env.LEPTONWEB_LLM_MODEL = "planner-model";
    process.env.LEPTONWEB_LLM_BASE_URL = "https://example.com/v1";
    process.env.LEPTONWEB_VERIFIER_MODEL = "verifier-model";
    delete process.env.LEPTONWEB_LEAVE_ONE_OUT_CONTRIBUTION;
    const supportedClaim = "The receipt chain binds the supported claim.";
    const unsupportedClaim = "This unsupported sentence must be removed.";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ role: string; content: string }>;
      };
      const system = body.messages[0]?.content ?? "";
      const content = system.includes("claim extractor")
        ? JSON.stringify({ claims: [supportedClaim, unsupportedClaim] })
        : JSON.stringify({
            supports: [
              {
                claim: supportedClaim,
                sourceId: SOURCE.id,
                span: "Excerpt: Verified source content.",
              },
              { claim: unsupportedClaim, sourceId: null, span: null },
              {
                claim:
                  "Additional grounded context keeps this answer long enough for the verifier.",
                sourceId: null,
                span: null,
              },
            ],
          });
      return new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const baseQuery = createQueryRecord(
        "How do stored citations bind receipts?",
        "2026-07-11T02:00:00.000Z",
        [SOURCE],
      );
      const citation = baseQuery.citations[0];
      if (!citation) throw new Error("missing contribution test citation");
      const query = {
        ...baseQuery,
        answer: `${supportedClaim} ${unsupportedClaim} Additional grounded context keeps this answer long enough for the verifier.`,
        citations: [{ ...citation, amountAtomicUsdc: 1_000 }],
        totalAtomicUsdc: 1_000,
      };

      const contributed = await applyContributionProof(
        query,
        [SOURCE],
        "judge-strict",
      );

      expect(contributed.answer).toContain(supportedClaim);
      expect(contributed.answer).not.toContain(unsupportedClaim);
      expect(contributed.claimSupport?.[0]?.status).toBe("supported");
      expect(contributed.claimSupport?.[1]?.status).toBe("unsupported");
      expect(contributed.contributionScores?.[0]).toMatchObject({
        sourceId: SOURCE.id,
        marginalContribution: 1,
        rewardAtomicUsdc: 1_000,
        fallback: false,
      });
      expect(contributed.contributionProof).toMatchObject({
        method: "leave-one-out-v1",
        counterfactuals: [{ omittedSourceId: SOURCE.id }],
      });
      expect(contributed.claimSupportRoot).toMatch(/^0x[0-9a-f]{64}$/);
      expect(contributed.claimSupportRoot).toBe(
        claimSupportRoot(
          contributed.claimSupport ?? [],
          contributed.contributionProof,
        ),
      );
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("uses the same stored-content builder as the verifier prompt", () => {
    expect(
      buildSourceContent(SOURCE, "claim-verification").paidExcerpt,
    ).toContain("Verified source content.");
  });
});
