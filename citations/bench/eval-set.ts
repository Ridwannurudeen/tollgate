export type BenchmarkClaim = {
  text: string;
  span: string;
};

export type BenchmarkCase = {
  id: string;
  question: string;
  goldSourceId?: string;
  claims: BenchmarkClaim[];
  expectedAbstention: boolean;
};

const QUESTION_VARIANTS = [
  "What does the payment path prove?",
  "Which mechanism matters for a source-backed agent?",
  "How does this help creator settlement?",
  "What should a judge verify here?",
];

const TOPICS: Array<{
  id: string;
  sourceId: string;
  prompt: string;
  claims: string[];
}> = [
  {
    id: "x402",
    sourceId: "x402-settlement-schemes",
    prompt: "Explain x402 settlement on Arc.",
    claims: [
      "x402 turns HTTP 402 into a real payment step",
      "The 'exact' scheme settles that authorization directly on Arc as a single USDC transfer",
    ],
  },
  {
    id: "gateway",
    sourceId: "circle-gateway-nano",
    prompt: "Explain Circle Gateway nanopayments.",
    claims: [
      "Circle Gateway batches signed EIP-3009 authorizations",
      "x402 payments can clear at sub-cent values without per-payment gas",
    ],
  },
  {
    id: "arc",
    sourceId: "arc-finality-usdc",
    prompt: "Explain Arc settlement.",
    claims: [
      "Arc is designed for stablecoin-native settlement",
      "Arc is designed for stablecoin-native settlement with USDC gas",
    ],
  },
  {
    id: "agent",
    sourceId: "autonomous-source-buying",
    prompt: "Explain how a source-buying answer agent works.",
    claims: [
      "An autonomous answer agent appraises candidate sources for relevance",
      "allocates a fixed micro-budget to the best grounding-per-USDC",
    ],
  },
  {
    id: "fee-router",
    sourceId: "feerouter-splits-receipts",
    prompt: "Explain FeeRouter citation payouts.",
    claims: [
      "The FeeRouter contract pays a creator by routing USDC through an on-chain split",
      "Each payout emits an evidence receipt hash-chained into a tamper-evident ledger",
    ],
  },
  {
    id: "escrow",
    sourceId: "unverified-source-escrow",
    prompt: "Explain ownership verification and escrow.",
    claims: [
      "A newly registered source is probationary until its owner proves control",
      "Until domain verification passes, citation payouts for that source are escrowed",
    ],
  },
  {
    id: "citation-economics",
    sourceId: "creator-citation-economics",
    prompt: "Explain the economics of a useful citation.",
    claims: [
      "A source payment should be tiny, automatic, visible to the creator",
      "A source payment should be tiny, automatic, visible to the creator, and tied to the answer that reused the work",
    ],
  },
  {
    id: "custody",
    sourceId: "custodial-payer-wallets",
    prompt: "Explain keyless custodial reader payments.",
    claims: [
      "Circle's developer-controlled (W3S) wallets let a reader pay without holding keys",
      "the payment still settles as real USDC on Arc",
    ],
  },
  {
    id: "rss",
    sourceId: "rsshub-distribution",
    prompt: "Explain why open feeds matter to creator payments.",
    claims: [
      "RSS and open feed communities already aggregate creator work",
      "making them strong surfaces for pay-per-citation and pay-per-read experiments",
    ],
  },
  {
    id: "lepton",
    sourceId: "canteen-lepton-rfb",
    prompt: "Explain the Lepton value thesis.",
    claims: [
      "Lepton asks builders to make sub-cent value move for agents and creators",
      "per article, per call, per second, and per citation",
    ],
  },
];

const relevantCases = TOPICS.flatMap((topic) =>
  QUESTION_VARIANTS.map((variant, index) => ({
    id: topic.id + "-" + String(index + 1).padStart(2, "0"),
    question: topic.prompt + " " + variant,
    goldSourceId: topic.sourceId,
    claims: topic.claims.map((text) => ({ text, span: text })),
    expectedAbstention: false,
  })),
);

const abstentionQuestions = [
  "What is the best chocolate chip cookie recipe?",
  "Which football club will win a match next month?",
  "How should a telescope photograph a distant galaxy?",
  "What is the safest way to repair a leaking kitchen tap?",
  "Which language is easiest for a first-time novelist?",
  "What are the opening hours of a restaurant in Lagos?",
  "How do I train a dog not to bark at birds?",
  "What is the best hiking route in the Alps this summer?",
  "Which battery chemistry belongs in an electric scooter?",
  "How should a gardener protect tomatoes from a local pest?",
];

export const BENCHMARK_EVAL_SET: BenchmarkCase[] = [
  ...relevantCases,
  ...abstentionQuestions.map((question, index) => ({
    id: "abstain-" + String(index + 1).padStart(2, "0"),
    question,
    claims: [],
    expectedAbstention: true,
  })),
];
