# Tollgate — Competitive Landscape

> Reference doc. Compiled 2026-06-25 from a multi-source web research pass. Figures are as-of the cited dates; re-verify before quoting in a submission. Legend: ✓ = yes · ~ = partial/adjacent · ✗ = no.

## The one-line positioning

**No verified competitor combines all three of Tollgate's core dimensions: per-_citation_ payment + an _autonomous agent_ paying live at inference + _on-chain USDC proof_.** Per-citation answer engines (ProRata, Perplexity) settle off-chain in fiat; on-chain players (Story, Numbers, x402) provide rails/royalties but run no citation market or answer engine. That tri-combination is the white space.

Primary foil: **ProRata.ai** — same per-citation thesis, but Tollgate adds the live autonomous agent and on-chain proof on Arc. Biggest threat: **Cloudflare** — the one incumbent assembling pay-per-crawl + a content marketplace + x402 stablecoin settlement.

## Competitor matrix

| Company | Per-citation | Agentic (live pay) | On-chain proof | Answer engine | Per-use creator payout | Funding / scale |
|---|---|---|---|---|---|---|
| **Tollgate (us)** | ✓ | ✓ | ✓ | ✓ | ✓ | hackathon build, live on Arc |
| ProRata.ai / Gist | ✓ | ✗ | ✗ | ✓ | ✓ | $40M B (Sep'25), $75M+ total |
| TollBit | ~ (per-inference) | ✗ | ✗ | ✗ (marketplace) | ✓ | $24M A (Oct'24), ~$31M total |
| Cloudflare Pay Per Crawl | ✗ (per-crawl) | ~ (x402) | ~ (via x402) | ✗ | ✓ | public (NYSE: NET) |
| Perplexity (Publishers / Comet Plus) | ✓ | ✗ | ✗ | ✓ | ~ (pool rev-share) | $42.5M publisher pool |
| Story Protocol (PIP Labs) | ✗ | ~ (Agent TCP/IP) | ✓ | ✗ | ✓ (royalties) | $134M total (a16z) |
| Numbers Protocol / Capture | ✗ (per-use media) | ~ (x402) | ✓ | ✗ | ✓ | GNI grant (Oct'25), NUM token |
| ScalePost | ✗ | ✗ | ✗ | ✗ | ✓ (rev share) | undisclosed |
| Created by Humans | ✗ | ✗ | ✗ | ✗ | ~ (licensing) | $11M total |
| Vermillio / TraceID | ✗ | ✗ | ✗ (unclaimed) | ✗ | ~ (payment mgmt) | $16M A (Sony Music) |
| Calliope Networks | ✗ | ✗ | ✗ | ✗ | ✓ (formula) | acquired by Protege |
| Getty Images (AI licensing) | ✗ | ✗ | ✗ | ✗ | ~ (bulk, opaque) | ~600k contributors |
| Shutterstock (Contributor Fund) | ✗ | ✗ | ✗ | ✗ | ✗ (training pool) | enterprise deals |

## Tier 1 — closest competitors

**ProRata.ai / Gist** — https://prorata.ai — AI answer engine that decomposes each answer to claim level and pays each cited source pro-rata (50/50 split). $40M Series B (Sep 2025, Touring Capital), $75M+ total, founded by Bill Gross, 500+ publishers. _Difference:_ off-chain fiat revenue-share, closed licensed-publisher network, no autonomous agent, no on-chain proof. (axios/businesswire, Sep 2025)

**TollBit** — https://tollbit.com — marketplace where AI bots pay publishers per-crawl and per-inference. $24M Series A (Lightspeed, Oct 2024), ~7,000 publisher sites (TIME, WaPo Arc XP). _Difference:_ centralized fiat billing, paywall/rail not an answer engine, no on-chain proof. (digiday)

**Cloudflare Pay Per Crawl** — https://blog.cloudflare.com/introducing-pay-per-crawl/ — per-crawl HTTP 402 charging; >1B 402 responses/day; acquired Human Native AI (Jan 2026); co-founded x402 Foundation with Coinbase. _Difference:_ per-crawl (pays the site, not each cited creator), access toll not answer engine — but the incumbent moving on-chain. (cnbc, Jan 2026)

**Perplexity — Publishers' Program / Comet Plus** — https://www.perplexity.ai/hub/blog/introducing-the-perplexity-publishers-program — answer engine sharing revenue with cited publishers via a $42.5M pool (80/20 split). _Difference:_ subscription-pool fiat rev-share, curated partners, no on-chain proof, not agentic per-citation. (searchenginejournal)

## Tier 2 — on-chain IP / per-use media (closest to the mechanism; incl. Aperture)

**Story Protocol (PIP Labs)** — https://story.foundation — L1 for programmable IP with automatic on-chain micro-royalties; $134M total (a16z crypto), "Homer" mainnet Feb 2025. _Difference:_ general IP infra, not an answer engine or citation market — a rail you could build on. (coindesk)

**Numbers Protocol / Capture** — https://numbersprotocol.io — closest analog to Aperture: per-use media micro-licensing via x402 + C2PA + immutable proof of usage; Google News Initiative grant (Oct 2025). _Difference:_ capture-at-creation camera/registry model, not a sidecar metering an existing self-hosted server; uses NUM token, not pure USDC.

## Tier 3 — adjacent licensing plays (fiat / bulk / vertical)

ScalePost (AI↔publisher licensing marketplace; brokered Perplexity deals; funding undisclosed) · Created by Humans ($11M; books/authors AI-rights) · Vermillio / TraceID ($16M, Sony Music; rights protection + NIL payment mgmt) · Calliope Networks (video collective license, acquired by Protege) · Getty Images & Shutterstock (bulk AI licensing with opaque pooled creator payouts — the "no-proof foil") · RSL / Really Simple Licensing (an open _pay-per-inference_ standard — adopt, don't fight; rslstandard.org).

## Not competitors — rails & integrations

**Payment rails (partners, not rivals):** x402 (Coinbase — the standard Tollgate is built on; 165M+ cumulative tx, but monthly volume thin as of 2026) · Circle Gateway + Nanopayments + Arc (Tollgate's exact settlement stack) · Google AP2 (Agent Payments Protocol) · Skyfire ($9.5M) · Nevermined ($4M — closest signed-per-use metering) · Catena Labs ($48M, ex-Circle founder) · Payman.

**Proof / attribution (adopt, don't compete):** C2PA / Content Credentials · Digimarc — verifiable attribution but no payment rail.

## Caveats (from the research, carried forward honestly)

- **Market-demand risk:** a March 2026 CoinDesk report found agent-micropayment demand "just not there yet" — the key risk to address in any pitch. (coindesk, Mar 2026)
- **Could NOT verify:** "ProvenAI" as a notable company (only research projects / name-collisions); a product literally named "Pin" (likely a mislabel of Catena Labs / ACK); exact funding amounts for ScalePost and Calliope. Treat these as unverified.

## Source index

ProRata: businesswire 2025-09-05 · axios 2025-09-05 · digiday. TollBit: tollbit.com/blog/series-a · digiday · prnewswire/axios 2024-10. Cloudflare: blog.cloudflare.com/introducing-pay-per-crawl · cnbc 2026-01-15 · blog.cloudflare.com/x402. Perplexity: perplexity.ai/hub · searchenginejournal · digiday. Story: coindesk 2024-08-21 · oakresearch · cointelegraph. Numbers: numbersprotocol.io · digitaljournal (GNI grant). x402/Circle: x402.org · docs.cdp.coinbase.com/x402 · circle.com/blog (Gateway/Nanopayments) · cryptobriefing. Others: adweek (ScalePost) · fortune/publishersweekly (Created by Humans) · businesswire/axios (Vermillio) · calliopenetworks.ai · gettyimages.com/ai · submit.shutterstock.com (Contributor Fund) · rslstandard.org · c2pa.org · digimarc.com · coindesk 2026-03-11 (demand).
