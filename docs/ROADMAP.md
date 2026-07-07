# Tollgate — Roadmap

Lepton funds continuity, not demos: "funding to take the project beyond the prototype," grants, and user-introductions go to teams showing "the beginning of something you'll still be building" a year out. This is a real one, with real numbers, real architectural constraints, and real risks — not a phase-1/phase-2 gesture.

## Ground truth: what exists today, and what it can't do yet

**Citations** (tollgate.gudman.xyz) and **Aperture** (tollgate.gudman.xyz/aperture) both settle through one codepath: `citations/src/lib/fee-router.ts`. Read closely, this is the actual constraint set the whole roadmap has to route around:

- **One hot wallet is the payer for every settlement.** `createFeeRouterSigner` signs every `pay()` call from a single `account`. There is no per-tenant signer, no multi-sig, no key rotation. This is fine at hackathon volume; it is a single point of failure and a single point of custodial risk at real volume, and it's the first thing a security-conscious integrator will ask about.
- **Settlement is sequential, not batched.** `for (const citation of routeableCitations) { ... await walletClient.writeContract(...); await publicClient.waitForTransactionReceipt(...) }` — one on-chain tx per citation, awaited before the next starts. We already fixed the polling-interval tax (250ms vs viem's 4000ms default, 77% latency cut), but the *sequential-nonce* structure itself is untouched and is a deliberately deferred project, not an oversight — parallelizing it means real nonce-management work (either a nonce manager or a batching contract call), and doing it carelessly risks double-spends or stuck transactions. This is Phase 1 engineering, not Phase 3.
- **Splits are a local JSON registry, not on-chain multi-tenancy.** `ensureCreatorSplit` reads/writes `data/fee-router-splits.json` under a lock (`splitRegistryLock`) and calls a single deployed `FEE_ROUTER_ADDRESS` contract per split. Every new creator/recipient split is created through our server, gated by our lock file. An external integrator cannot self-serve a split without touching our infra.
- **Standing allowance is a workaround, not a design.** `STANDING_FEE_ROUTER_ALLOWANCE = 10_000_000_000n` (10,000 USDC) exists specifically because per-payout exact-amount approval was racing under concurrent settlement. It works, but it means the hot wallet holds a large standing approval — acceptable at current scale, a real audit finding once external money is at stake.

None of this is a criticism of the hackathon build — it's *exactly right* for proving the payment loop works end-to-end on two real apps in three weeks. But "extract it into an SDK" is meaningless until these four constraints are actually redesigned. That redesign work — not a rebrand — is Phase 1.

## The thesis

Tollgate is not "two content-monetization apps." It's a bet that **pay-per-piece will replace subscriptions for machine-consumed content** the way Stripe replaced manually-reconciled invoices — and the wedge is that AI agents (not humans) are about to become the largest class of paying customer for narrowly-scoped content: one citation, one photo, one API call, one inference. Humans tolerate subscriptions because they amortize cost across habitual use. Agents don't have habits — they have tasks, and a task needs exactly one answer, one photo, one dataset row. Subscription pricing is structurally wrong for agent-consumed content. Per-piece, machine-verifiable, sub-cent settlement is structurally right. Citations and Aperture are the two proof points (text, media); the real product is the rail underneath, and the real customer, eighteen months out, is other people's agents and other people's paywalls — not end-users of our two apps.

## Competitive reality check (say the quiet part)

x402 itself (Coinbase's spec) and Circle's Gateway already solve "an agent can pay via HTTP 402." That is not our moat — it's the substrate everyone building on Arc gets for free. Our actual differentiated surface, if we're honest, is narrower and has to be named explicitly or the roadmap is vapor:

1. **The FeeRouter split + receipt model** — turning a single payment into a verifiable creator payout with a hash-chained receipt, which x402/Gateway alone don't give you.
2. **The ownership-verification ladder** (wallet-signature → meta-tag → DNS-TXT, closed against the self-attestation exploit this session) — nobody else building on Arc has had to solve "how do we know this registrant actually owns this content" yet, because nobody else has real external creators registering real content yet. We do, today.
3. **The auth_request-gated reverse-proxy pattern** for existing infra (Immich today) — a recipe for bolting per-piece payment onto software that was never built for it, without rewriting that software.

If by Month 6 none of these three are things a third party explicitly chose Tollgate *for*, the thesis has failed and the roadmap should say so rather than keep shipping phases.

## Phase 0 (done, verified in repo): the two proof points

- Citations: real content-grounded answers, honest zero-source decline with on-chain reader refund, custodial demo via Circle W3S, ownership-trust exploit closed, settlement latency cut 77%.
- Aperture: BYO-link registration (raw/GitHub-blob/Drive-view URLs normalized), nginx `auth_request` license gate proven against real receipts, watermarked/downscaled preview generation (sharp, uncommitted as of this doc — land it first).
- Shared: one design system, one FeeRouter contract, one Arc RPC config (`citations/src/lib/chain.ts`).

## Phase 1 — Weeks 1–6: make the constraints above someone else's non-problem

This is the part a shallow roadmap skips: before "extract an SDK," the underlying system has to survive a second tenant.

- **Week 1–2: creator payout dashboard.** Aperture registers creators (`registerCreator`) but gives them no visibility into earnings. Ship it — this is the first thing any real external creator asks for, and it's a forcing function to formalize "what does a creator's ledger even look like" before more tenants exist.
- **Week 2–4: nonce-safe concurrent settlement.** Replace the sequential `for` loop's implicit nonce-per-await with an explicit nonce manager (reserve nonce → submit → confirm, with a bounded-concurrency pool) so multiple citations *and* multiple tenants can settle in parallel without racing. This is the single highest-risk, highest-payoff engineering item in the whole roadmap — get it wrong and a second tenant's traffic corrupts the first tenant's payouts.
- **Week 3–5: per-tenant split registry.** Move `fee-router-splits.json` from a single flat file to a namespaced, tenant-scoped store (still simple — SQLite or a keyed JSON store, not over-engineered) so a second integrator's creator splits can't collide with or be edited by the first's.
- **Week 5–6: extract `@tollgate/pay-per-piece`.** Only now — with concurrency-safe settlement and tenant-scoped splits actually built — does pulling the FeeRouter + x402-custodial logic into a standalone package mean anything. Ship it with one worked example (a toy article-paywall app, not Citations or Aperture) as proof it works outside our two apps.
- **Metric that decides if Phase 1 worked:** a second, independent Next.js app (built by us, not a real external partner yet) can gate content behind a receipt-checked paywall using only the published package, in under a day, with zero access to our production `data/` directory or hot wallet key.

## Phase 2 — Months 2–4: one real external creator, one real external integrator

- Onboard the first creator who is not us — real content, real payout, real testnet (then small-cap mainnet) USDC. This is the concrete version of the FAQ's "real progress on both fronts" test for continuing teams: track the product delta (SDK extracted, dashboard shipped) *and* the user-growth delta (this creator, plus whatever cohort came from strangers already asking to test it) separately, and report both.
- Package the `auth_request` gate as a documented, config-driven recipe (nginx today; Caddy and a Cloudflare Worker variant next) so "add per-piece payment to existing software" stops being VPS-specific tribal knowledge and becomes something a third party can follow without us.
- RFB1/RFB2 extension: let an agent be the *payer* against the published SDK, not just a human reader — budget-capped autonomous purchasing, reusing the Circle W3S custodial pattern already proven in `x402-custodial.ts`, but now generalized to any content type the SDK gates, not hardcoded to citations.
- **Metric:** at least one integration initiated by someone outside the founding team, even a small one, using the public package with no direct hand-holding beyond docs.

## Phase 3 — Months 4–9: the two remaining RFBs, as extensions not pivots

- RFB3 (agent-to-agent networks): the citations agent already produces a sellable output (a sourced answer). Let it sell that answer to *other agents*, per-call, through the same FeeRouter split — the first real agent-to-agent transaction on the rail, not a simulated one.
- RFB4 (streaming/pay-per-second): extend the settlement primitive from single-shot receipts to metered accrual (compute, live media) — same split logic, different accrual model, built on top of the nonce-safe concurrent settlement from Phase 1, not a rewrite of it.
- Move the hot-wallet-payer model (constraint #1 above) toward a real answer: either a proper multi-sig/HSM-backed signer for production volume, or a documented, audited case for why the single-signer model is acceptable at whatever volume exists by then. Don't let this slide silently — it's the kind of gap that turns into a real incident once real money is flowing.
- First small-stakes mainnet USDC relationship on Arc with a real creator — the actual graduation from "testnet payments" to "creators get paid real money," capped and monitored, not a big-bang switch.

## Phase 4 — Months 9–18: prove it's a rail, not two apps with good PR

- Success metric, stated plainly: **at least one production integration we did not build**, running on the published SDK, paying real creators real money, that we found out about because someone told us, not because we shipped it.
- Formalize the ownership-verification ladder (wallet-signature/meta-tag/DNS-TXT) into a portable, queryable trust layer other integrators can check against, instead of re-solving "how do we know this registrant owns this content" per integrator — this is the compounding moat item, since every integrator who *doesn't* have to solve it themselves is a reason to build on Tollgate instead of raw x402.
- Only now consider any FeeRouter governance/decentralization work — multi-tenant volume big enough that single-operator control of the contract is a real risk worth the complexity, not before. Premature decentralization here is complexity with no users to justify it, and the roadmap should keep saying so at every phase gate rather than assume it by default.

## Verification ladder — near-term feature backlog

The ownership-verification methods today are meta-tag / DNS-TXT (domain control, clears probation + releases escrow) and wallet-signature (binds the payout wallet, does NOT clear probation — closes the payout-diversion exploit). Two gaps for creators who don't control the content's hosting:

- **ORCID author verification (planned).** For academic/journal-hosted papers, the creator can't add a meta tag to a third-party PDF or edit the journal's DNS. ORCID is the trusted-registry answer: "Sign in with ORCID" (OAuth 3-legged, `/authenticate` scope) proves the person *is* that ORCID iD, then read their works via `GET api.orcid.org/v3.0/{iD}/works` and match the registered article's **DOI**. If the DOI is in their ORCID record → verified as author, legitimately, no website needed. Requires: a DOI field on source registration + the ORCID OAuth round-trip + a works/DOI match, added as a third verify method next to meta-tag/DNS. Free public API, non-commercial terms. Prereq on the researcher's side: the paper must be listed in their ORCID (Add works → by DOI).
- **Creator-claimed tier (shipping now, lighter).** A deliberately weaker, honestly-badged self-claim via wallet-signature for content that can't be domain- or ORCID-verified — see its own scope doc. Trade-off is explicit: it relaxes the escrow-hold that the wallet-signature hardening introduced, so it MUST be badged distinctly from "verified" and never masquerade as domain verification.

## Media storage — Walrus as a future backend, not today

Aperture's video/photo originals are stored on the VPS's local disk (verified: 111GB free on a shared, 91%-full disk). **Walrus** (Sui's decentralized blob-storage protocol) was considered as an alternative and verified in detail: it has a simple HTTP PUT/GET publisher/aggregator API (no client-side wallet code needed), and testnet WAL has no real cost. But it's not the right fit for *today's* build: (1) the public testnet publisher caps blobs at **10 MiB by default** — smaller than the 100MB video cap this feature needs; (2) mainnet has **no free public publisher** — it costs real SUI/WAL and means running your own publisher node, ongoing infra; (3) it's a **Sui-ecosystem protocol**, and everything else in Tollgate (FeeRouter, x402, Circle Gateway) is deliberately Arc-only — introducing Walrus means a second chain dependency for a concern (storage) that's orthogonal to payment. Revisit as a real, properly-scoped feature if/when VPS disk usage actually becomes the constraint, or if a genuinely decentralized storage story becomes worth the added chain dependency for the pitch — not squeezed into a payment-rail build under time pressure.

## What kills this roadmap, and how we'll know early

- **If Phase 1's nonce-safety work slips and a second tenant is onboarded on the sequential-await settlement anyway** — that's a live double-spend/stuck-payout risk with real creator money, not a bug ticket. This gates Phase 2's external creator onboarding hard; don't skip it under deadline pressure.
- **If by the end of Phase 2 no integration exists that we didn't build ourselves** — the SDK isn't actually usable, and continuing to build Phase 3 features on it is building on a foundation nobody but us has tested. Stop and fix onboarding friction instead of shipping more RFBs.
- **If the ownership-verification/trust-ladder work (moat item #2) never gets formalized past "the fix we shipped for our own exploit"** — competitors building on raw x402 catch up on the one thing we currently have and they don't, and the "why build on Tollgate instead of x402 directly" answer evaporates.

## Immediate next step (this week, not next quarter)

Commit the uncommitted work already sitting in the repo (Aperture watermarked preview + this session's SCOPE-driven fixes), then start the nonce-safe settlement redesign — not the payout dashboard, not the SDK extraction. The concurrency fix is the one piece of Phase 1 that gets harder and riskier the longer real traffic runs on the sequential-await version, so it goes first even though the dashboard is more visible.
