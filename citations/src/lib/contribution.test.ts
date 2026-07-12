import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "./agent";
import {
  extractClaims,
  removeUnsupportedClaims,
  scoreContribution,
  verifyClaims,
} from "./contribution";
import { buildSourceContent } from "./source-content";
import { applyContributionProof } from "./settlement";
import { createQueryRecord } from "./engine";
import { REPAIR_PROMPT } from "./json-parse";
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

  it("repairs one malformed claim-extraction response", async () => {
    const answer = "The receipt chain binds each useful claim to a source record.";
    const calls: ChatMessage[][] = [];
    const claims = await extractClaims(answer, async (messages) => {
      calls.push(messages);
      return calls.length === 1
        ? "not json"
        : JSON.stringify({ claims: [answer] });
    });

    expect(claims).toEqual([answer]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.slice(-2)).toEqual([
      { role: "assistant", content: "not json" },
      { role: "user", content: REPAIR_PROMPT },
    ]);
  });

  it("fails claim extraction after one unsuccessful repair attempt", async () => {
    const calls: ChatMessage[][] = [];

    await expect(
      extractClaims(
        "The receipt chain binds each useful claim to a source record.",
        async (messages) => {
          calls.push(messages);
          return calls.length === 1 ? "not json" : "still not json";
        },
      ),
    ).rejects.toThrow("LLM did not return JSON.");
    expect(calls).toHaveLength(2);
  });

  it("repairs one malformed claim-verification response", async () => {
    const claim = "The receipt binds the claim.";
    const span = "Excerpt: Verified source content.";
    const calls: ChatMessage[][] = [];
    const support = await verifyClaims([claim], [SOURCE], async (messages) => {
      calls.push(messages);
      return calls.length === 1
        ? "not json"
        : JSON.stringify({
            supports: [{ claim, sourceId: SOURCE.id, span }],
          });
    });

    expect(support[0]).toMatchObject({
      claim,
      sourceId: SOURCE.id,
      span,
      status: "supported",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.slice(-2)).toEqual([
      { role: "assistant", content: "not json" },
      { role: "user", content: REPAIR_PROMPT },
    ]);
  });

  it("marks claims unable to verify after one unsuccessful repair attempt", async () => {
    const calls: ChatMessage[][] = [];
    const support = await verifyClaims(
      ["The receipt binds the claim."],
      [SOURCE],
      async (messages) => {
        calls.push(messages);
        return calls.length === 1 ? "not json" : "still not json";
      },
    );

    expect(support).toEqual([
      {
        claim: "The receipt binds the claim.",
        sourceId: null,
        span: null,
        status: "unable-to-verify",
      },
    ]);
    expect(calls).toHaveLength(2);
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

  it("computes hand-checkable leave-one-out rewards", () => {
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
      ].map((name) => [name, process.env[name]]),
    );
    process.env.LEPTONWEB_LLM_API_KEY = "test-key";
    delete process.env.OPENAI_API_KEY;
    process.env.LEPTONWEB_LLM_MODEL = "planner-model";
    process.env.LEPTONWEB_LLM_BASE_URL = "https://example.com/v1";
    process.env.LEPTONWEB_VERIFIER_MODEL = "verifier-model";
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
      expect(contributed.claimSupportRoot).toMatch(/^0x[0-9a-f]{64}$/);
      expect(fetchMock).toHaveBeenCalledTimes(2);
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
