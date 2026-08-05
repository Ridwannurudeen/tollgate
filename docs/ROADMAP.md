# Tollgate — Roadmap

Lepton funds continuity, not demos: "funding to take the project beyond the prototype," grants, and user-introductions go to teams showing "the beginning of something you'll still be building" a year out. This is a real one, with real numbers, real architectural constraints, and real risks — not a phase-1/phase-2 gesture.

Status claims below were re-verified against the code and the live deployment on **2026-08-05**. The previous revision of this document had gone stale in the worst way — it named work as "next" that had already shipped, which is how a roadmap stops being read. If you are reading this more than a month out, re-verify before trusting it.

## Ground truth: the four constraints, and where each actually stands

**Citations** (tollgate.gudman.xyz) and **Aperture** (tollgate.gudman.xyz/aperture) both settle through one codepath: `citations/src/lib/fee-router.ts`. The four constraints that shaped this roadmap are not equally resolved, and pretending otherwise is how the last revision went wrong.

- **The signer collision is fixed; single-signer custody is not.** `FACILITATOR_PRIVATE_KEY` and `LEPTONWEB_FEE_ROUTER_PRIVATE_KEY` used to resolve to the *same address*, so the x402 facilitator settled reader payments from the account the FeeRouter was allocating nonces for. That collision took every paid query down from 2026-07-18 to 2026-08-04 — readers were charged and handed a 502 with no receipt. `2ad6b9c` made it recover instead of fail; on 2026-08-05 the keys were actually separated (facilitator `0x12f6…13a5`, FeeRouter `0x4164…cbcEe`), verified by a live paid query in which each wallet spent gas on its own leg. What remains is the original constraint in its narrower form: `createFeeRouterSigner` still signs every creator payout from one hot key, with no per-tenant signer, no multi-sig, and no rotation. That is custodial risk at volume, not a live incident, and it is the last item below rather than the first.
- **Settlement is nonce-safe but still serialized — half resolved.** `withReservedNonce` (`citations/src/lib/fee-router-nonce.ts`) reserves nonces through a queue with a bounded submission pool, so concurrent callers no longer race. But `routeCitationPayments` still walks `for (const payment of payments)` awaiting each `pay()` and its receipt before starting the next. The dangerous half — nonce management — is done; the latency half is not. Parallelising it is now a much smaller job than it was, because the reservation primitive already exists.
- **Splits are tenant-scoped but single-writer — narrower than previously documented.** Records already carry a `tenantId` and `ensureCreatorSplit` matches on it (`DEFAULT_FEE_ROUTER_TENANT_ID = "citations-core"`), and `registryPath` is injectable, so a second tenant does *not* collide on split identity — an earlier revision of this document claimed it would, and that was wrong. What is genuinely unresolved is storage and access: every tenant's splits live in one `data/fee-router-splits.json` serialized by one in-process `splitRegistryLock`, which means a single writer on a single host, and an external integrator still cannot self-serve a split without touching our infra. `pay-per-piece` ships the pluggable `SplitRegistryStore` interface that fixes the first half.
- **Standing allowance is unchanged.** `STANDING_FEE_ROUTER_ALLOWANCE = 10_000_000_000n` (10,000 USDC) is still granted. Acceptable at current scale, still a real audit finding once external money is at stake.

## The thesis

Tollgate is not "two content-monetization apps." It's a bet that **pay-per-piece will replace subscriptions for machine-consumed content** the way Stripe replaced manually-reconciled invoices — and the wedge is that AI agents (not humans) are about to become the largest class of paying customer for narrowly-scoped content: one citation, one photo, one API call, one inference. Humans tolerate subscriptions because they amortize cost across habitual use. Agents don't have habits — they have tasks, and a task needs exactly one answer, one photo, one dataset row. Subscription pricing is structurally wrong for agent-consumed content. Per-piece, machine-verifiable, sub-cent settlement is structurally right. Citations and Aperture are the two proof points (text, media); the real product is the rail underneath, and the real customer, eighteen months out, is other people's agents and other people's paywalls — not end-users of our two apps.

## Competitive reality check (say the quiet part)

x402 itself (Coinbase's spec) and Circle's Gateway already solve "an agent can pay via HTTP 402." That is not our moat — it's the substrate everyone building on Arc gets for free. Our actual differentiated surface is narrower and has to be named explicitly or the roadmap is vapor:

1. **The FeeRouter split + receipt model** — turning a single payment into a verifiable creator payout with a hash-chained receipt, which x402/Gateway alone don't give you.
2. **The ownership-verification ladder** — wallet-signature → creator-claimed → meta-tag → DNS-TXT, closed against the self-attestation exploit. Nobody else on Arc has had to solve "how do we know this registrant owns this content," because nobody else has real external creators registering real content yet.
3. **The auth_request-gated reverse-proxy pattern** for existing infra (Immich today) — a recipe for bolting per-piece payment onto software never built for it, without rewriting that software.

If by Month 6 none of these three are things a third party explicitly chose Tollgate *for*, the thesis has failed and the roadmap should say so rather than keep shipping phases.

## What has shipped (verified in repo and on the live deployment)

- **Both proof points.** Citations: content-grounded answers, honest zero-source decline with on-chain reader refund, custodial demo via Circle W3S, ownership-trust exploit closed. Aperture: email-only signup with a minted custodial wallet, direct upload and BYO-link, watermarked previews, nginx `auth_request` license gate, buyer/seller messaging.
- **The creator payout dashboard** (`aperture/src/app/dashboard/page.tsx`) — aggregates Aperture and Citations earnings by wallet, with custodial withdraw. This was Phase 1's first item and it is done.
- **`tollgate-pay-per-piece` on npm** — the FeeRouter + x402 logic extracted, with a worked toy-paywall example and a recorded live Arc proof. Phase 1's exit metric (a second app gating content using only the published package, with no access to our `data/` or hot wallet) is met.
- **Nonce-safe settlement** — see the constraint above; the safety half is real.
- **The creator-claimed verification tier** — a deliberately weaker, distinctly badged self-attestation for creators who control neither the hosting nor a domain. It never sets the strong `verifiedCreator` flag.
- **Claim-priced settlement** (`4c4da8b`) — x402 must quote before the answer exists, so the quote is now a ceiling: readers are charged per *supported* claim at `LEPTONWEB_CLAIM_PRICE_ATOMIC` (2,500 in production) and refunded the balance on-chain, floored at what creators were already paid. A fully-supported four-claim answer earns the full quote; a thin one refunds most of it.
- **Agent-as-payer** (`9ce621e`) — the answer agent buys grounding from allowlisted x402 endpoints under a per-endpoint cap and a daily spend cap. This is the RFB1/RFB2 direction, live but dormant until an allowlist is configured.
- **Separated settlement signers** (2026-08-05) — the facilitator now submits reader settlements from `0x12f6…13a5` while the FeeRouter pays creators from `0x4164…cbcEe`. Proven by a live paid query in which each wallet spent gas on its own leg: 2,017 atomic from the facilitator, 8,576 from the FeeRouter (2,500 refund + 4,000 payouts + gas). This is what actually closes the two-week outage; `2ad6b9c` only stopped it being fatal.
- **A paid-query canary** (`6a9a919`) — daily synthetic purchase asserting the answer settles, the ledger verifies, and the query count actually grew, alerting to Telegram on failure. It exists because the outage above ran for two weeks behind a `/core` that returned 200 the entire time.

## Next — in order, and the order matters

1. **Parallelise `routeCitationPayments`.** It still walks `for (const payment of payments)`, awaiting each `pay()` and its receipt before starting the next, so a three-citation answer serializes three round-trips. Now a bounded-concurrency wrapper around an existing primitive — `withReservedNonce` already queues reservations and caps in-flight submissions — rather than the risky redesign it once was. Latency, not correctness.
2. **Give the split registry a real store.** Ranked lower than an earlier revision put it, because tenant *scoping* already works and that revision was wrong to say otherwise. What remains is that every tenant's splits share one flat file behind one in-process lock — a single writer on a single host — and integrators cannot self-serve a split without our infra. Adopt the SDK's `SplitRegistryStore` interface rather than designing another one.
3. **One real external integrator.** The published SDK has never been used by someone outside the founding team without hand-holding. Until it has, we are guessing about onboarding friction.
4. **The `auth_request` gate as a config-driven recipe** — Caddy and a Cloudflare Worker variant alongside nginx, so "add per-piece payment to existing software" stops being VPS-specific tribal knowledge.
5. **ORCID author verification.** Still unbuilt; no `orcid` anywhere in `citations/src`. For academic content the creator can't meta-tag a third-party PDF or edit a journal's DNS. "Sign in with ORCID" (OAuth, `/authenticate`), then match the registered DOI against `GET api.orcid.org/v3.0/{iD}/works`. Needs a DOI field on source registration. Free API, non-commercial terms.
6. **A real answer for the FeeRouter hot key.** Now that the facilitator is split off, this is the residue of constraint one: every creator payout, for every tenant, is still signed by one key with no rotation and a 10,000 USDC standing allowance. Either move it behind a multi-sig or HSM-backed signer, or write down an audited argument for why single-signer is acceptable at whatever volume exists by then. It sits last because it is custodial risk rather than a live failure — but it should not slide silently, which is exactly how the collision above survived as long as it did.

Further out, unchanged in substance: agent-to-agent resale of sourced answers through the same split; metered accrual for streaming and compute; a portable, queryable trust layer so integrators stop re-solving ownership verification; and a first small-stakes mainnet relationship with a real creator. FeeRouter governance/decentralisation stays deliberately last — premature decentralisation is complexity with no users to justify it, and this document should keep saying so at every gate.

Also still open, carried in from the wave plan this document replaces (the rest of that plan — escrow-until-verified, the keystore/W3S signer seam, custodial wallets and withdraw, RSS/Atom import, probation, multi-contributor splits, the MCP server, `/.well-known/tollgate.json`, the embeddable widget, and the Jellyfin sidecar — has shipped):

- **Migrate the ledger from JSON to SQLite** while preserving hash-chain verification. `citations/data/ledger.json` is still the store, now 2.6MB and rewritten wholesale on every append. Not urgent at 180 queries; it becomes urgent well before it becomes obvious.
- **A `@tollgate/reader` SDK** for agents and apps. `tollgate-pay-per-piece` is the *seller* half — gating and paying out. Nothing packages the buyer half, so every reader integration is still hand-rolled x402.
- **The music lane** (Navidrome/scrobble-based settlement) remains a design in `docs/LANE-MUSIC.md`, not an implementation.

## Verification ladder

Ownership today is proven by wallet-signature (binds the payout wallet, does **not** clear probation — this closes the payout-diversion exploit), meta-tag and DNS-TXT (domain control, clears probation and releases escrow), and the deliberately weaker **creator-claimed** self-attestation for creators who control neither the hosting nor a domain. Creator-claimed is badged distinctly and never sets the strong `verifiedCreator` flag; that separation is the whole reason it is safe to offer.

Two gaps remain:

- **ORCID author verification.** Unbuilt — there is no `orcid` anywhere in `citations/src`. For academic content the creator can't meta-tag a third-party PDF or edit a journal's DNS. "Sign in with ORCID" (OAuth 3-legged, `/authenticate` scope) proves the person is that iD, then `GET api.orcid.org/v3.0/{iD}/works` matched against the registered **DOI** proves authorship. Needs a DOI field on source registration. Free public API, non-commercial terms; the researcher must have the paper listed in their ORCID record.
- **First-claim provenance for media.** Aperture's duplicate detection only catches re-registration of content already on Tollgate. It does nothing about the first, novel claim of someone else's photo lifted from elsewhere. Closing that needs either a real dispute process — which requires introducing some payout hold, since instant payout leaves nothing to freeze — or provenance signals like C2PA Content Credentials for content that carries them. See `docs/SCOPE-APERTURE-DUPLICATE-DETECTION.md`.

## Media storage — Walrus as a future backend, not today

Aperture's video/photo originals are stored on the VPS's local disk (verified: 111GB free on a shared, 91%-full disk). **Walrus** (Sui's decentralized blob-storage protocol) was considered and verified in detail: it has a simple HTTP PUT/GET publisher/aggregator API (no client-side wallet code needed), and testnet WAL has no real cost. But it's not the right fit for *today's* build: (1) the public testnet publisher caps blobs at **10 MiB by default** — smaller than the 100MB video cap this feature needs; (2) mainnet has **no free public publisher** — it costs real SUI/WAL and means running your own publisher node, ongoing infra; (3) it's a **Sui-ecosystem protocol**, and everything else in Tollgate (FeeRouter, x402, Circle Gateway) is deliberately Arc-only — introducing Walrus means a second chain dependency for a concern (storage) orthogonal to payment. Revisit if VPS disk actually becomes the constraint, or if a genuinely decentralized storage story becomes worth the added chain dependency — not squeezed into a payment-rail build under time pressure.

## What kills this roadmap, and how we'll know early

- **If the shared-signer split keeps sliding because the symptom is masked.** The nonce fix bought time, not a solution. A second tenant, a second facilitator, or any new signer on that wallet re-opens the same failure — and next time it may not be a testnet reader who eats it.
- **If nothing outside the founding team ever integrates.** The SDK is published, documented, and proven against a toy app *we* wrote. That is not evidence it's usable. If no external integration exists and we are still shipping features on top of it, we are building on a foundation nobody but us has tested.
- **If observability regresses.** A total payment outage went unnoticed for two weeks. The canary closes that specific hole; it does not make the system observable. Every new settlement path needs to answer "what proves this still works tomorrow" before it ships, not after it silently breaks.
- **If the trust ladder never generalises past our own exploit fix.** Competitors on raw x402 catch up on the one thing we have and they don't, and "why build on Tollgate instead of x402 directly" evaporates.

## Boundaries

No mainnet rollout, package publishing, VPS deployment, or community submission happens without explicit operator approval.
