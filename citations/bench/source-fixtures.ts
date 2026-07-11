import { sha256Hex } from "../src/lib/hash";
import type { CreatorSource, SourceOwnershipProof } from "../src/lib/types";

export const BENCHMARK_FIXTURE_VERSION = "ws5-2026-07-11-v1";

type SourceFixtureInput = Omit<
  CreatorSource,
  "sourceKind" | "creatorKind" | "verifiedCreator" | "ownershipProof"
>;

export type BenchmarkSourceFixture = Readonly<
  Omit<CreatorSource, "tags" | "ownershipProof">
> & {
  readonly tags: readonly string[];
  readonly ownershipProof: Readonly<SourceOwnershipProof>;
};

const SEED_VERIFIED_AT = "2026-06-27T00:00:00.000Z";

function freezeSource(source: SourceFixtureInput): BenchmarkSourceFixture {
  return Object.freeze({
    ...source,
    tags: Object.freeze([...source.tags]),
    sourceKind: "seed" as const,
    creatorKind: "seed" as const,
    verifiedCreator: false,
    ownershipProof: Object.freeze({
      method: "seed-demo" as const,
      verifiedAt: SEED_VERIFIED_AT,
    }),
  });
}

export const BENCHMARK_SOURCE_FIXTURES: readonly BenchmarkSourceFixture[] =
  Object.freeze([
    freezeSource({
      id: "canteen-lepton-rfb",
      title: "Lepton RFB Notes",
      creator: "Canteen Research",
      handle: "@canteen",
      wallet: "0x1111111111111111111111111111111111111111",
      url: "https://lepton.thecanteenapp.com",
      summary:
        "Lepton asks builders to make sub-cent value move for agents and creators: per article, per call, per second, and per citation.",
      tags: ["lepton", "nanopayments", "creators", "arc", "x402"],
      priceAtomicUsdc: 1_800,
    }),
    freezeSource({
      id: "circle-gateway-nano",
      title: "Gateway Nanopayments Primer",
      creator: "Circle Developer Notes",
      handle: "@circledev",
      wallet: "0x2222222222222222222222222222222222222222",
      url: "https://developers.circle.com/gateway/nanopayments",
      summary:
        "Circle Gateway batches signed EIP-3009 authorizations so x402 payments can clear at sub-cent values without per-payment gas.",
      tags: ["circle", "gateway", "eip-3009", "x402", "usdc"],
      priceAtomicUsdc: 2_400,
    }),
    freezeSource({
      id: "arc-finality-usdc",
      title: "Arc Settlement Sketch",
      creator: "Arc Builder Desk",
      handle: "@buildonarc",
      wallet: "0x3333333333333333333333333333333333333333",
      url: "https://docs.arc.network",
      summary:
        "Arc is designed for stablecoin-native settlement with USDC gas, sub-second finality, and app kits for payment workflows.",
      tags: ["arc", "usdc", "settlement", "app-kit", "finality"],
      priceAtomicUsdc: 2_200,
    }),
    freezeSource({
      id: "rsshub-distribution",
      title: "RSS Distribution Surface",
      creator: "Open Feed Maintainers",
      handle: "@rsshub",
      wallet: "0x4444444444444444444444444444444444444444",
      url: "https://github.com/DIYgod/RSSHub",
      summary:
        "RSS and open feed communities already aggregate creator work, making them strong surfaces for pay-per-citation and pay-per-read experiments.",
      tags: ["rss", "feeds", "distribution", "creators", "open-source"],
      priceAtomicUsdc: 900,
    }),
    freezeSource({
      id: "forum-mandates",
      title: "Covenant Account Spend Controls",
      creator: "Forum Protocol",
      handle: "@ggudman",
      wallet: "0x5555555555555555555555555555555555555555",
      url: "https://forum.gudman.xyz",
      summary:
        "Forum-style mandates bound an agent budget, publish receipts, and make spend controls enforceable instead of advisory.",
      tags: ["forum", "receipts", "mandates", "spend-control", "agents"],
      priceAtomicUsdc: 1_500,
    }),
    freezeSource({
      id: "creator-citation-economics",
      title: "Citation Economics for AI Answers",
      creator: "Indie Researcher",
      handle: "@sourcepaid",
      wallet: "0x6666666666666666666666666666666666666666",
      url: "https://example.com/citation-economics",
      summary:
        "A source payment should be tiny, automatic, visible to the creator, and tied to the answer that reused the work.",
      tags: ["citations", "attribution", "publishers", "answers", "economics"],
      priceAtomicUsdc: 1_200,
    }),
    freezeSource({
      id: "x402-settlement-schemes",
      title: "x402 Settlement Schemes on Arc",
      creator: "Payments Protocol Notes",
      handle: "@x402notes",
      wallet: "0x7777777777777777777777777777777777777777",
      url: "https://x402.org",
      summary:
        "x402 turns HTTP 402 into a real payment step: a resource returns payment requirements, the client signs an EIP-3009 USDC authorization, and the server settles it. The 'exact' scheme settles that authorization directly on Arc as a single USDC transfer, so the reader's debit is a verifiable on-chain transaction. The Circle Gateway-batched scheme instead pools many signed authorizations for gasless sub-cent settlement, referenced by a Gateway payment id rather than one Arc tx.",
      tags: ["x402", "eip-3009", "settlement", "arc", "usdc"],
      priceAtomicUsdc: 1_300,
    }),
    freezeSource({
      id: "feerouter-splits-receipts",
      title: "FeeRouter Split Payouts and Receipts",
      creator: "Receipt Ledger Notes",
      handle: "@receiptledger",
      wallet: "0x8888888888888888888888888888888888888888",
      url: "https://forum.gudman.xyz/fee-router",
      summary:
        "The FeeRouter contract pays a creator by routing USDC through an on-chain split keyed to the creator's wallet and basis-point shares, so multi-contributor works divide automatically. Each payout emits an evidence receipt hash-chained into a tamper-evident ledger. Sub-cent citations accrue to a claimable FeeRouter balance the creator withdraws with a single claim call, which keeps per-citation gas from swamping the payment.",
      tags: ["feerouter", "splits", "receipts", "payouts", "arc"],
      priceAtomicUsdc: 1_600,
    }),
    freezeSource({
      id: "autonomous-source-buying",
      title: "How a Source-Buying Answer Agent Works",
      creator: "Agent Commerce Notes",
      handle: "@agentcommerce",
      wallet: "0x9999999999999999999999999999999999999999",
      url: "https://example.com/source-buying-agent",
      summary:
        "An autonomous answer agent appraises candidate sources for relevance, allocates a fixed micro-budget to the best grounding-per-USDC, and buys only what it needs. It drafts an answer grounded strictly in the purchased content, self-critiques to drop any claim a purchased source does not support, and can buy one more source during reflection. Every step is recorded and hashed into the answer, so the reasoning and the payments are auditable together.",
      tags: ["agents", "rag", "budget", "citations", "grounding"],
      priceAtomicUsdc: 1_300,
    }),
    freezeSource({
      id: "unverified-source-escrow",
      title: "Escrow and Ownership Verification",
      creator: "Creator Licensing Desk",
      handle: "@creatorlicensing",
      wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      url: "https://example.com/ownership-escrow",
      summary:
        "A newly registered source is probationary until its owner proves control of the source domain with a DNS TXT record or meta tag. A wallet signature can confirm the payout wallet, but it does not clear probation by itself. Until domain verification passes, citation payouts for that source are escrowed rather than released. This stops an anonymous registrant from pointing someone else's URL at their own wallet to divert a creator's earnings.",
      tags: ["escrow", "verification", "ownership", "creators", "payouts"],
      priceAtomicUsdc: 1_400,
    }),
    freezeSource({
      id: "custodial-payer-wallets",
      title: "Keyless Custodial Wallets for Readers",
      creator: "Custodial Wallet Notes",
      handle: "@custodialnotes",
      wallet: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      url: "https://developers.circle.com/w3s",
      summary:
        "Circle's developer-controlled (W3S) wallets let a reader pay without holding keys or a browser wallet: the server provisions a custodial wallet and signs the x402 EIP-3009 authorization through Circle's API. This makes a one-click paid query possible for someone who has never touched crypto, while the payment still settles as real USDC on Arc and pays the cited creators through the same FeeRouter.",
      tags: ["circle", "w3s", "custodial", "x402", "usdc"],
      priceAtomicUsdc: 1_400,
    }),
  ]);

export const BENCHMARK_SOURCE_FIXTURE_HASH = sha256Hex(
  BENCHMARK_SOURCE_FIXTURES,
);

export function cloneBenchmarkSource(
  fixture: BenchmarkSourceFixture,
): CreatorSource {
  return {
    ...fixture,
    tags: [...fixture.tags],
    ownershipProof: { ...fixture.ownershipProof },
  };
}
