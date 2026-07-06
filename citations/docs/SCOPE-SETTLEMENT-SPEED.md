# Codex scope — speed up paid-query settlement (confirmed root cause)

A 3-citation paid query takes ~20-22s. Diagnosed live (instrumented, timed, reverted — see below): roughly **9.2s is LLM calls** (appraise/draft/critique — inherent to the reasoning trace, do not touch) and **~9.0s is on-chain settlement** for 3 sequential citation payouts.

**Confirmed root cause of the settlement half:** `src/lib/fee-router.ts`'s `createFeeRouterPublicClient` (~line 136) calls `createPublicClient` with no `pollingInterval` set. Viem's default (`node_modules/viem/_cjs/clients/createClient.js:14`) is `clamp(blockTime/2, 500, 4000)` — and `arcTestnet` (`src/lib/chain.ts`) does not define a `blockTime`, so viem falls back to a generic default that clamps to **4000ms**. But Arc's real block time is ~444ms (measured directly from the VPS: 9 blocks in 4 seconds). Every `waitForTransactionReceipt` call can therefore pad up to ~4 extra seconds of pure polling delay past when the tx actually confirmed. With 3 sequential citation payouts (`fee-router.ts` ~line 592 `for (const citation of routeableCitations)` — sequential loop, do not change the sequencing itself, that's a separate parallelization project with real nonce-management risk not in scope here), this compounds significantly.

## Fix — one line, zero risk to payment logic
In `src/lib/fee-router.ts`, add `pollingInterval: 250` to the `createPublicClient` call in `createFeeRouterPublicClient`. Also check whether `createFeeRouterSigner`'s wallet client (or any other place a public/wallet client is constructed for on-chain reads/writes in this file, e.g. any client used by `refundReaderPayment` or `ensureCreatorSplit`) has the same missing config — apply the same `pollingInterval: 250` everywhere a public client is created for Arc in this file, so ALL on-chain waits benefit consistently.

Do not change `waitForTransactionReceipt` call sites themselves, retry counts, or timeout values — only the client construction's polling interval. Do not touch the sequential-loop structure, split-creation logic, or any payment amount/routing logic.

## Verification (do this yourself before calling it done)
1. Confirm the change compiles and existing fee-router tests still pass (they use injected mock clients per `fee-router.test.ts`'s `mockClients` helper, so a real `pollingInterval` change should have zero effect on test behavior — mocks don't poll).
2. On the VPS (ask the operator/me to deploy, or if you have a way to test the real network from your environment), time a real 3-citation paid query before/after. Expect the settlement portion to drop from ~9s toward ~1-2s (Arc's real block time is sub-second, so a 250ms poll should typically catch confirmation within one or two polls).
3. Do NOT reduce the LLM-side time (appraise/draft/critique) — that's the demonstrated agentic reasoning trace and is out of scope; cutting it would remove exactly what's being judged as "agentic sophistication."

## Acceptance
- `pollingInterval: 250` (or similar, tuned if you find a better value via testing — just justify it against Arc's measured ~444ms block time) set on every Arc public client in `fee-router.ts`.
- `npm run typecheck && npm test && npm run build` green.
- No change to payout amounts, routing, sequencing, or any payment-decision logic — this is purely how fast the client notices an already-confirmed transaction.
