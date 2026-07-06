# Codex scope — honest "I can't answer this" instead of hallucinating a citation

Today, when NO registered source is relevant to a question, the agent does the wrong thing: `agent.ts:502` treats "LLM selected zero sources" as a thrown error → falls back to the deterministic engine → `engine.ts:165` **force-buys the cheapest source anyway** → returns a template that pretends the irrelevant source answers the question, and pays that creator. Verified live: asking "best recipe for chocolate chip cookies?" bought an unrelated RSS source (900 atomic), paid its creator, returned nonsense, and refunded nothing. This must become an honest decline.

All paths relative to `citations/`. Read every file before editing. Match existing style. Run `npm run typecheck && npm test && npm run build`. Do NOT change x402 verification/settlement wire code or contracts.

## Model facts (so the fix fits reality)
- Reader pays `PAID_QUERY_PRICE_ATOMIC_USDC` (10000 = $0.01) via x402 — settled on-chain, only `/api/paid-query`. `/api/query` is FREE (no reader payment).
- Citation payouts to creators come from the protocol's FeeRouter wallet, bounded by `DEFAULT_SOURCE_BUDGET_ATOMIC_USDC` (6500).
- `refundSummary` / `refund-unused` (economics.ts, `queryPaymentEconomics`) tracks **unused source budget NOT paid to creators** — it does NOT return the reader's on-chain $0.01.
- The relevance loop already skips `score <= 0` (engine.ts:156); it's the `selectedSources.length === 0` FALLBACK (engine.ts:165-176) that force-buys regardless.

---

## PART A — Honest decline (REQUIRED; fixes the dishonesty on both paths)

Goal: when no relevant source exists, buy NOTHING, pay NO creator, and return an honest "no source covers this" answer — no fake citation, no misleading template.

1. **`agent.ts` ~502** — replace `throw new Error("LLM appraisal selected no affordable known source.")` with a graceful CANNOT_ANSWER outcome. Add a helper (e.g. `buildCannotAnswerRecord`) that returns a valid `QueryRecord` with: empty `citations`, `totalAtomicUsdc: 0`, empty `receiptHashes`, an `agentSteps` trace showing appraise ran and found nothing worth buying, `agentMode: "llm"`, `agentRationale` like "No registered source was relevant enough to cite, so the agent bought nothing and did not fabricate an answer.", and an honest `answer` (see #3). Do NOT let this fall through to the deterministic force-buy.

2. **`engine.ts:165-176`** — REMOVE the force-buy fallback. When `selectedSources.length === 0`, the deterministic path must also yield an empty selection (so the LLM-down path is honest too). Downstream (`createQueryRecord`, `deterministicAnswer`) must handle zero selected sources.

3. **`engine.ts deterministicAnswer` (~223) + `createQueryRecord` (~277)** — when `selectedSources` is empty: return an honest decline answer (a shared constant, e.g. `NO_SOURCE_ANSWER = "No registered source covers this question, so the agent did not buy a citation or fabricate an answer. Try a question about the registered sources (AI payments, x402, Arc, agent commerce, creator licensing)."`), `citations: []`, `totalAtomicUsdc: 0`, and an agentSteps trace noting nothing was bought. Do NOT emit the "It bought the minimum useful bundle…" boilerplate.

4. **Draft too-short guard (`agent.ts:339-340`)** — leave as-is (that's a different case: sources were bought but the model produced garbage). Only the zero-source case changes.

5. **UI** — verify `/answers/[queryId]` and `LatestAnswer` render cleanly with zero citations + the decline answer (empty-citation state must not crash or look broken). The showcase-selection on `/ask` already prefers a good LLM answer, so a decline won't poison the front page — but confirm.

6. **Tests** — (a) LLM loop with an appraisal that selects zero sources → returns a CANNOT_ANSWER record (empty citations, $0 total, honest answer), NOT a throw; (b) deterministic `planCitationMarket`/`createQueryRecord` with all-irrelevant sources → empty selection + decline answer, no force-buy; (c) economics: a zero-citation query reports `creatorPayoutsAtomicUsdc: 0`.

**After Part A, the embarrassing behavior is gone:** off-topic questions get an honest "I can't source this," nobody is paid for an irrelevant citation, and the deterministic fallback no longer fabricates.

---

## PART B — Refund the reader on an unanswerable PAID query (RECOMMENDED, but has on-chain cost)

Only `/api/paid-query` (+ the custodial demo) take a reader payment. When such a query resolves to CANNOT_ANSWER, refund the reader's $0.01 on-chain so "the agent honestly declines AND refunds you" is literally true.

- In `settlement.ts settlePaidQuestion`, after the agent record is built: if the record is a CANNOT_ANSWER (zero citations / a flag you set on the record in Part A, e.g. `answered: false`), send the reader's `amountAtomicUsdc` USDC back to `settlement.payer` from the protocol's funded wallet (reuse the existing fee-router signer / a dedicated refund key — do NOT hardcode a key; read from env like `LEPTONWEB_FEE_ROUTER_PRIVATE_KEY`). Record it in `refundSummary` (`refundedAtomicUsdc`, `refundReason: "no-answer"`) and reflect it on the receipt/answer UI ("reader payment refunded — no source to cite, tx …").
- **Tradeoff to flag in the PR:** this is one extra on-chain USDC transfer + gas per unanswerable paid query, and needs the refunding wallet funded. Guard it: if the refund send fails, still return the honest answer (log the failure; don't crash the query).
- If the user opts to skip Part B, the paid path still behaves honestly (no fake citation, no creator paid); it just retains the $0.01 query fee.

**Recommendation:** ship Part A now (it removes the dishonesty and is self-contained). Do Part B if you want the stronger "declines and refunds" demo line — it's a small USDC transfer but adds a funded-wallet dependency + a per-query tx.

## Acceptance
- Asking an off-topic question (e.g. "best cookie recipe") returns an honest decline: **zero citations, $0 paid to creators, no fabricated template**, on BOTH the free and paid paths (verify live).
- No source is force-bought when nothing scores as relevant; `engine.ts` force-buy fallback is gone.
- `/answers/[id]` and `/ask` render the zero-citation decline cleanly.
- (If Part B) an unanswerable paid query refunds the reader on-chain, recorded in `refundSummary`, and a refund-send failure degrades gracefully.
- `npm run typecheck && npm test && npm run build` green. No x402/contract changes.
