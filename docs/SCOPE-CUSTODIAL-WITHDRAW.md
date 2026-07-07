# Scope - withdraw custodial (Circle W3S) balance to an external wallet

**Real, verified gap:** a creator who signed up with just an email gets a Circle-managed ("circle-w3s" custody) wallet — they never hold its private key. Money settles into it (Aperture: `payTo: photographer.wallet` directly at sale; Citations: `FeeRouter.claim()` moves split funds into the same custodial wallet), but **there is currently no way for that creator to move funds OUT of the custodial wallet to anywhere they actually control.** Citations' claim route only moves funds *into* the custodial wallet; Aperture has no claim/withdraw endpoint at all; neither app's `circle-w3s.ts` has a transfer-out function. Self-custody creators don't have this problem — they already hold the key.

**Goal:** a "Withdraw to your own wallet" action, available in both apps, that lets a custodial creator send their USDC balance to an external address they specify, via Circle's existing contract-execution API.

**Verified reusable pieces (do not reinvent):**
- `citations/src/lib/circle-w3s.ts` `w3sExecuteContract({ walletId, walletAddress, contractAddress, abi, functionName, functionArgs })` — a generic Circle contract-call executor already used for `FeeRouter.claim()`. **Aperture does NOT have this function yet** — port it over from citations (same shape, same Circle API endpoint `/developer/transactions/contractExecution`) rather than writing a new one.
- `citations/src/lib/fee-router.ts` `usdcRouterAbi` — already has `balanceOf` and (check) `transfer`/`approve` fragments; reuse this exact ABI (or its `transfer` fragment) for the USDC `transfer(to, amount)` call — do not redefine a new ABI.
- `ARC_USDC = "0x3600000000000000000000000000000000000000"` — identical constant in both apps' `chain.ts`.
- Both apps' `WalletRegistryEntry`/creator records already carry `custody: "self" | "circle-w3s"` and `walletId` (Circle's wallet id, present only for custodial entries) — the withdraw action is only ever offered/allowed when `custody === "circle-w3s"` and `walletId` is present.

This touches real money movement — read every relevant file before editing in both `aperture/` and `citations/`. Run `npm run typecheck && npm test && npm run build` in BOTH apps. Do NOT change how payments settle INTO the custodial wallet (existing x402/FeeRouter/claim logic stays as-is) — this is purely the new outbound leg.

## Build (mirror in both apps — same pattern, each app's own registry/session)

### 1. Port/add `w3sExecuteContract` to Aperture (`aperture/src/lib/circle-w3s.ts`)
- Copy the citations implementation verbatim (same Circle API call, same signature) — this is infrastructure Aperture is simply missing, not something to redesign.

### 2. Withdraw function (new `withdraw.ts` in each app, or add to `circle-w3s.ts`/`fee-router.ts` as fits the app's existing organization)
- `async function withdrawCustodialUsdc({ walletId, walletAddress, toAddress, amountAtomicUsdc }): Promise<Hex>`:
  - Read on-chain USDC balance via `publicClient.readContract({ address: ARC_USDC, abi: usdcRouterAbi, functionName: "balanceOf", args: [walletAddress] })`.
  - Reject if `amountAtomicUsdc` is not a positive integer, or exceeds the real on-chain balance (never trust a client-supplied balance figure — always re-check on-chain immediately before submitting).
  - Call `w3sExecuteContract({ walletId, walletAddress, contractAddress: ARC_USDC, abi: usdcRouterAbi, functionName: "transfer", functionArgs: [toAddress, amountAtomicUsdc] })`.
  - Return the transaction hash. Let Circle's own error surface propagate as a clear message (no swallowed catch).

### 3. API route — session/owner-gated in Aperture, wallet-scoped in Citations
- **Aperture:** `POST /aperture/api/account/withdraw` (session-gated via `getSessionOwner()` — a creator can ONLY withdraw from their OWN account's wallet, never an arbitrary walletId from the request body). Body `{ toAddress, amountAtomicUsdc }`. Validate: session exists; `owner.custody === "circle-w3s"` and `owner.walletId` present (else 400 "only custodial wallets can withdraw this way — self-custody wallets already hold your funds"); `toAddress` is a valid `0x` + 40 hex address (reuse the existing wallet-validation regex pattern already used for linked-wallets); reject if `toAddress` equals the custodial wallet itself (no-op transfer) or is the zero address. Rate-limit (mirror `assertLoginLinkRateLimit`'s pattern — a new `assertWithdrawRateLimit`, tight, e.g. 5/hour, since this is a financial action).
- **Citations:** extend or add alongside `POST /api/creators/[wallet]/claim` — a new `POST /api/creators/[wallet]/withdraw` with the SAME abuse-bounding comment style already in `claim/route.ts` (no signature possible for custodial creators, so bound the abuse surface: always pays out of that wallet's own on-chain balance to a caller-supplied address, never moves more than the real balance, rate-limited). Since citations has no login/session system (per this project's architecture — identity is wallet-based here, not accounts), this route is necessarily wallet-address-keyed like `claim` already is; keep it at the SAME trust level as the existing `claim` endpoint (custody-gated + rate-limited), not a stronger bar than what's already accepted for `claim`.

### 4. UI
- **Aperture dashboard** (`src/app/dashboard/page.tsx` + new `WithdrawForm.tsx` client component): shown ONLY when `owner.custody === "circle-w3s"`. Fields: destination address, amount (pre-filled/capped to current on-chain balance, fetched live not from a stale cached figure), a clear confirmation step ("this cannot be undone — double check the address") before submitting, since address typos mean permanent loss. Show the resulting tx hash + an Arcscan link on success.
- **Citations creator page** (`src/app/creators/[wallet]/page.tsx`, next to the existing `CreatorWithdrawPanel`/claim UI): add the same destination-address + amount + confirm UI calling the new withdraw route.

## Tests
- `withdrawCustodialUsdc`: rejects non-positive/non-integer amounts; rejects amount exceeding a mocked on-chain balance; calls `w3sExecuteContract` with the exact `transfer` args when valid; propagates Circle API errors without swallowing them.
- Aperture route: no session → 401; self-custody owner → 400 (can't use this path); missing/invalid `toAddress` → 400; `toAddress` equal to own wallet or zero address → 400; rate-limit trips; valid request calls the withdraw function with the SESSION owner's walletId (never a client-supplied one).
- Citations route: same abuse-bounding tests as the existing `claim` route's test suite, extended for the transfer-out behavior; balance-exceeds-request still transfers only up to the real balance or rejects cleanly (pick one behavior and test it explicitly — recommend reject-if-insufficient, do not silently partial-transfer).
- No regression to existing `claim()`/settlement behavior in either app.

## Security invariants (non-negotiable — this moves real money)
- Aperture: strictly session-gated to the caller's OWN wallet — never accept an arbitrary walletId/ownerId from the request body.
- Both apps: on-chain balance is re-checked immediately before submitting the transfer — never trust a client-supplied or cached amount.
- Destination address strictly validated as a well-formed `0x` address; reject self-transfer and the zero address.
- Rate-limited per creator/IP to bound abuse if credentials/session leak.
- No swallowed errors on the transfer call — a failed Circle API call must surface clearly, not silently report success.
- No new dependency; reuses the existing Circle W3S contract-execution API and USDC ABI already in the codebase.

## Operator tasks
- Confirm `CIRCLE_API_KEY`/`CIRCLE_ENTITY_SECRET` (already required for existing custodial flows) remain valid in both `/etc/aperture.env` and `/etc/tollgate.env`.
- Deploy both apps; live-verify: as a real custodial creator with a nonzero balance, withdraw a small amount to a wallet you control, confirm the tx lands on Arcscan and the balance updates; confirm a self-custody creator does NOT see/can't use the withdraw action; confirm an oversized withdrawal request is rejected, not partially executed.

## Acceptance
- A custodial creator can withdraw their real USDC balance to an external address they specify, from their Aperture dashboard and/or their Citations creator page.
- Self-custody creators are unaffected (they already hold their funds directly).
- On-chain balance is always re-verified before transfer; no overdraft is possible.
- `npm run typecheck && npm test && npm run build` green in BOTH apps. No new dependency. Existing settlement/claim logic unchanged.
