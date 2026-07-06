# Codex scope — judge-readiness fixes (final limitations audit)

Source: full adversarial judge walkthrough + technical hardening audit of the live site + repo. Goal: every claim a judge clicks survives scrutiny; the biggest money-risk is closed; the front page can never be poisoned by a bad query. One PR.

All paths relative to `citations/` unless noted. Read every file before editing. Match existing style. Run `npm run typecheck && npm test && npm run build` before finishing. Do NOT touch x402 signing/settlement protocol code or contracts. The LLM credits issue is handled separately — do not touch `/etc` or env files.

Context you must know: the production LLM planner is currently down (billing), so recent ledger records are deterministic-mode fallbacks. LLM-mode records DO exist in the ledger (the `/demo` page features one). `agentMode` and `agentRationale` are recorded per query.

---

## 1. Front page can never showcase a broken answer (CRITICAL)
`src/app/ask/page.tsx:19` picks `ledger.queries[0]` (most recent) as the showcased "latest answer". Right now that's a deterministic fallback whose `agentRationale` literally contains "LLM planner failed with HTTP 400" — rendered publicly.

Fix:
- **Showcase selection:** prefer the most recent query with `agentMode === "llm"`; fall back to most-recent only if no LLM record exists. Keep it labeled honestly (e.g. "latest agent-planned answer") — do not misrepresent recency; show its actual timestamp.
- **Never render raw fallback errors:** wherever `agentRationale` is rendered (LatestAnswer, answers/[queryId], anywhere else — grep for `agentRationale`), if the rationale matches the fallback pattern (starts with "LLM planner fallback"), render a neutral label like "deterministic planner (LLM unavailable)" instead of the raw error string. Keep the raw string in the ledger/API (auditability) — this is display-only.
- **Free-run CTA primacy:** in `AskWorkbench.tsx`, make the no-wallet "Run local proof" the visually primary action (primary button style) and the paid x402 query secondary, with copy like "Run the agent free — no wallet needed" / "Pay $0.01 via x402 (MetaMask + Arc)". Do not remove or weaken the paid path — it's the protocol demo; just reorder prominence.

## 2. Close the payment-diversion hole: escrow unverified by default (CRITICAL, verified live)
`src/lib/fee-router.ts` `escrowUnverifiedEnabled()` returns `process.env.TOLLGATE_ESCROW_UNVERIFIED === "1"` — opt-IN, and prod doesn't set it, so an unverified (potentially squatted-URL) external source gets paid immediately.

Fix: invert the default — escrow unverified external sources UNLESS explicitly disabled: `process.env.TOLLGATE_ESCROW_UNVERIFIED !== "0"`. Update any test that assumed the old default (search tests for TOLLGATE_ESCROW_UNVERIFIED). Check the escrow release path (on verification) still works — read the release code and its test before changing. Mention the new default in README's security/hardening notes if they exist.

## 3. Traction framing: lead with what survives audit (HIGH)
The homepage aggregate ("$0.36 routed / 11 creators") includes synthetic seed personas (e.g. wallet `0x1111111111111111111111111111111111111111` "Canteen Research") in the "who got paid" table — a judge who sees an obviously-synthetic wallet next to earnings dismisses the whole board.

Fix (display-layer only; do NOT alter ledger data):
- Wherever creator earnings tables render (`LandingPage.tsx`, `/creators` page, EarningsBoard): badge rows whose source is seed/internal (`creatorKind`/`sourceKind === "seed"` — check the actual field in `summarizeCreators` output and join with sources if needed) with the existing seed/demo label style. External creators render prominently first.
- On the landing hero/metrics, add a one-line defensible-traction strip near the aggregate: "3 independent teams registered, verified ownership, and were paid real USDC on Arc — 2 onboarded autonomously by their own agents." (This is the verified claim from docs/TRACTION.md — read it and keep the wording consistent with it.)
- `/proof` already has a traction-quality section — link the landing strip to it.

## 4. Reconcile contradictory numbers (HIGH)
- **Slash totals:** `/proof` renders the SlashBond contract's `totalSlashed` (lifetime, across all test bonds — currently 4.91 USDC) while `/demo` shows the demo bond's slash (0.000001). Judges see 98%-slashed vs ~0 and conclude the accountability story is broken. Fix: label the `/proof` figure explicitly ("lifetime slashed across all test bonds (includes deliberate demo slashes)") or scope it to the current bond so the two pages reconcile. Read `src/lib/forum.ts:133` + both pages first and pick the labeling that is truthful.
- **Money totals:** homepage "routed to creators $0.3605" vs /proof "creator payouts $0.0869 / protocol retained $0.0401". These measure different things but share a vocabulary. Fix: one consistent metric naming across landing//ask//proof (e.g. "payments recorded" vs "creator payouts (external)" vs "protocol retained"), each stat labeled with what it counts. Trace where each number comes from (`summarizeCreators`, economics helpers) so labels are accurate, then align copy.
- **Model transparency:** stamp the LLM model into the agent trace: in `src/lib/agent.ts`, include `model: config.model` in the recorded agent metadata (there's an agentSteps/record structure — find where agentMode is recorded and add model alongside). Render it on the answer page trace ("planned by <model>") when agentMode is llm. This makes traceHash meaningfully auditable.

## 5. Cold-page performance (MEDIUM)
`/creators` took ~48s cold and `/proof` ~7.5s (server-side on-chain reads per request).
Fix: cache the on-chain reads (`readFeeRouterClaimable`, slash-bond/forum reads) with a short in-memory TTL (~60s) — a tiny module-level cache map with timestamp is enough; follow existing lib style. Do NOT cache the ledger itself. Verify with `npm run build` + timing a local prod render of /creators twice (second hit should be fast).

## 6. Competitive strip (MEDIUM)
`docs/COMPETITIVE-LANDSCAPE.md` (repo root docs/) is strong but invisible. Add a compact "why not ProRata / TollBit / Cloudflare pay-per-crawl" section to the landing page (3 short columns lifted from that doc's thesis: per-citation granularity × live autonomous agent × public on-chain proof — competitors have at most two of three). Keep it factual and non-disparaging; cite no numbers you can't back.

## 7. Receipt honesty labeling (MEDIUM)
Most receipts are `forum-routed` (accrue in FeeRouter, claimable later) — only a few are per-tx settled. Cards/copy that imply every receipt is its own on-chain tx overstate. Fix: where receipts render with settlement mode, label forum-routed as "accrued → claimable on-chain" (and keep the existing claim-tx links where present). One-line explainer on /proof: "sub-cent citations batch into on-chain FeeRouter balances; creators claim real USDC anytime." Batching is the design — state it proudly, don't hide it.

## 8. Content-hash real content at registration (MEDIUM)
`src/lib/catalog.ts` `registrationContentEvidence` already fetches and SHA-256s the live URL body but only when `TOLLGATE_REGISTRATION_FETCH=1` (off by default). Fix: default it ON (`!== "0"`), keep the SSRF-safe fetch path (it must go through safeFetch — verify it does), tolerate fetch failure gracefully (registration still succeeds, evidence just absent). Update tests accordingly.

## Acceptance
- /ask always showcases an LLM-mode answer when one exists; no raw "LLM planner failed" text renders anywhere public.
- Unverified external sources escrow by default (test proves it); explicit `TOLLGATE_ESCROW_UNVERIFIED=0` restores old behavior.
- Seed personas visibly badged in every earnings table; defensible-traction strip on landing.
- /proof and /demo slash figures reconcile or are unambiguously labeled; money metrics share one vocabulary; LLM model visible in llm-mode traces.
- Second render of /creators is sub-second locally (cache hit).
- Landing has the competitive strip; receipts labeled accrued/claimable.
- `npm run typecheck && npm test && npm run build` green. No x402/contract/protocol changes; no env-file changes.

---

## 9. PeerTube payout is now PROVEN on-chain — upgrade the claim (do this)
The plugin's own `routeCreatorPayment` (lib/fee-router.js — the exact code the `/pay` endpoint runs) was executed against a configured, running PeerTube 8.2.2 instance and settled real USDC to the creator via FeeRouter on Arc testnet. Verified on-chain (operator nonce 3→7, USDC spent 15817 atomic incl. gas; both txs status=success, to=FeeRouter):
- **Creator payout (FeeRouter.pay) tx:** `0x1ed2e7caa90964100d843095acc4f3e5c5f5bf9203850e91d2cab8f838c1a49d`
- **Create-split tx:** `0x6d64332a97b31ef0f3e9f78069e2dc897efe964375608a1082830301d7d86286`
- Operator: `0xD25345D27E1409D2ace25e348Bd9dDb30B72b82B` → Creator split #162 → recipient `0x645b8cc3A35A204D0cd025cccbd61618Ab9e139C` (2500 atomic USDC, claimable — same accrue-then-claim model as the citations forum-routed lane).

Configuration/gating was verified against the running instance (payoutsEnabled:true, gateDownloads:true, creator-wallet resolution) but the full HTTP download→pay round-trip was NOT completed (WSL/redis stack instability), so do NOT claim "full HTTP end-to-end download flow." The accurate, strong claim:

> "The PeerTube plugin's payout code routes real USDC to the creator's FeeRouter split on Arc — proven on-chain (pay tx 0x1ed2e7…c1a49d). Download gating and operator config verified against a running PeerTube 8.2.2 instance; payout accrues to the creator's split, claimable like every other Tollgate lane."

Update these surfaces to the proven framing (replace the "pending an operator key" caveat):
- `src/app/video/page.tsx`: set `PEERTUBE_PAYOUT_TX` to the new pay tx `0x1ed2e7caa90964100d843095acc4f3e5c5f5bf9203850e91d2cab8f838c1a49d`; relabel the row honestly ("creator payout via plugin (FeeRouter.pay)"); remove the "pending operator key" line, add that it routes to the creator's claimable split. Keep it non-overstated.
- Root `README.md` (PeerTube row): swap the "pending an operator key" wording for the proven pay tx + "routes to creator's FeeRouter split, claimable".
- `docs/WHAT_CHANGED_DURING_LEPTON.md`, `citations/docs/SUBMISSION.md`, `citations/docs/VIDEO-SCRIPT.md`: same reframe — plugin payout proven on Arc (cite the pay tx), gating verified on a running instance; drop "pending operator key".

Do NOT claim per-download HTTP automation. The honest proven claim is: plugin payout CODE settles real USDC on Arc, triggered against a configured running PeerTube instance.
