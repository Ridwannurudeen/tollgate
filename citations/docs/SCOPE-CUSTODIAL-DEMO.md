# Codex scope — one-click custodial paid demo (no wallet needed)

Goal: a judge clicks one button and experiences a REAL x402-settled reader payment — signed by Tollgate's Circle W3S custodial wallet, no MetaMask/faucet. This removes the "the paid loop is unreachable for a fresh judge" objection.

**Already proven working (do not re-derive):** the CLI script `scripts/prove-w3s-paid-query.mjs` does exactly this end-to-end against prod — payer `0x9d2d80946a60f22143143eb466f22032b0cef6b2` (Circle W3S wallet), `settlementMode: x402-settled`, real reader-payment hash, 3 creator receipts. Your job is to expose that same flow as a rate-limited server endpoint + a button. The payer wallet is provisioned + funded (0.50 USDC) and `CIRCLE_PAYER_WALLET_ID`/`CIRCLE_PAYER_ADDRESS` are set in prod env.

All paths relative to `citations/`. Read every file before editing. Match existing style. Run `npm run typecheck && npm test && npm run build` before finishing. Do NOT touch the x402 settlement/protocol internals or contracts — only compose existing pieces.

**⚠️ This endpoint spends real testnet USDC ($0.01/call) from a shared wallet. The rate limits + global cap + balance guard below are the point of the task, not optional polish. Get them right.**

---

## 1. Port W3S signing into the server lib
`src/lib/circle-w3s.ts` already has the Circle API plumbing (its `w3sMintWallet`/`w3sExecuteContract` use an internal request + entity-secret sealing). Add, reusing those internals (do NOT duplicate the request/seal helpers):
- `w3sSignTypedData(walletId: string, typed: <EIP-712 typed data>, memo?: string): Promise<Hex>` — port verbatim behavior from `scripts/circle-w3s.mjs` (POST `/developer/sign/typedData` with `{ walletId, data: encodeEip712(typed), entitySecretCiphertext: <seal>, memo }`, return `resp.data.signature`).
- `encodeEip712(typed)` helper — port from `scripts/circle-w3s.mjs` lines ~85-100 (serializes types/domain/primaryType/message with bigint→string). Match exactly; the signature is byte-sensitive.
- `payerWalletId()` → `requireEnv("CIRCLE_PAYER_WALLET_ID")`, `payerAddress()` → `requireEnv("CIRCLE_PAYER_ADDRESS")` (use the lib's existing env accessor).
Type it properly (no `any`) — the typed-data param type can mirror what `ExactEvmScheme`'s signer.signTypedData receives.

## 2. Custodial paid-fetch lib
New `src/lib/x402-custodial.ts`, porting `scripts/x402-paid-fetch-w3s.mjs`:
```
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { w3sSignTypedData } from "./circle-w3s";
const ARC_CAIP2 = "eip155:5042002";
export function createW3SPaidFetch({ walletId, address }) {
  const signer = { address, signTypedData: (m) => w3sSignTypedData(walletId, m, "Tollgate x402") };
  return wrapFetchWithPaymentFromConfig(fetch, { schemes: [{ network: ARC_CAIP2, client: new ExactEvmScheme(signer) }] });
}
```

## 3. Rate limits + global cap (in `src/lib/rate-limit.ts`)
Follow the existing in-memory bucket pattern. Add:
- `assertDemoPaidQueryRateLimit(ipKey)` — per-IP: **2 per 24h**. 429 message: "Demo limit reached (2/day). Connect your own wallet to run more paid queries."
- A **global daily counter**: **30 per 24h** across all IPs. Separate function `assertDemoPaidQueryGlobalCap()`. 429 message: "The shared demo wallet's daily budget is used up. Try the free run, or connect your own wallet." Reset on a rolling 24h window like the others.
Both must be checked before spending. Export both. Add tests to `rate-limit`'s test file (or a new `demo-paid-query.test.ts`) covering: per-IP 3rd call blocked, global 31st call blocked.

## 4. The endpoint: `src/app/api/paid-query/demo/route.ts` (POST, runtime nodejs)
Order of operations (fail before spending):
1. `requestIp` (prefer x-real-ip over left-most XFF, like `sources/discover/route.ts`).
2. `assertDemoPaidQueryRateLimit(ip)` then `assertDemoPaidQueryGlobalCap()` → 429 on throw.
3. **Balance guard:** read the payer's USDC balance on Arc (reuse the viem public client / ARC_USDC from `chain`/`fee-router` helpers) for `payerAddress()`. If `< PAID_QUERY_PRICE_ATOMIC_USDC` (from `@/lib/payments`), return 503 `{ error: "The demo wallet is out of testnet USDC. Try the free run, or connect your own wallet." }`. This prevents ugly on-chain reverts when drained.
4. Read/validate the question (reuse `validateQuestion`); if absent, use a fixed demo question constant.
5. Build `createW3SPaidFetch({ walletId: payerWalletId(), address: payerAddress() })` and POST `{ question }` to `${request.nextUrl.origin}/api/paid-query` (server-to-self, preserves the full x402 flow). Only count the rate-limit/global tallies AFTER a successful settlement, OR reserve-then-release on failure — pick one and be consistent so a failing call doesn't burn a judge's quota. (Simplded: increment only on 2xx.)
6. Return the paid-query JSON (payer, settlementMode, readerPaymentHash, receipts, answer) with 201. On the sub-call failing, return its error with a friendly wrapper (500) and do NOT increment counters.

Guard the whole thing: if `CIRCLE_PAYER_WALLET_ID`/`CIRCLE_PAYER_ADDRESS` are unset (e.g. local dev), return 503 "custodial demo not configured" rather than throwing.

## 5. Button in `src/components/AskWorkbench.tsx`
A distinct third action alongside the existing "Run the agent free" and the paid/connect-wallet path:
- Label: **"Pay $0.01 on us — no wallet needed"** with subtext "settled by a Circle W3S custodial wallet". Secondary/tertiary styling — the free run stays primary.
- On click: POST `/api/paid-query/demo` (no body or `{ question }` from the input if present). Show a spinner; on success render the settled result reusing the existing paid-result UI (LatestAnswer / receipt evidence), clearly labeled "reader payment settled by Tollgate's Circle W3S custodial wallet (x402-settled)" with the Arcscan tx link.
- Handle 429/503 by showing the returned `error` message inline (not a crash).
- Do NOT remove or demote the free run.

## 6. Copy / honesty
This is a REAL settlement funded by Tollgate for the demo — say exactly that. Do not imply the judge paid, and do not imply external demand. It demonstrates the x402 custodial path, nothing more.

## Acceptance
- `POST /api/paid-query/demo` returns an x402-settled result with `payer` = the custodial address, real reader-payment hash, and creator receipts — with the plugin dir / wallet present.
- 3rd call from one IP within 24h → 429; 31st call globally → 429; both with the specified messages.
- With the payer drained (simulate by pointing balance check at an empty address in a test, or a unit test on the guard), returns 503, not a revert.
- Counters do not decrement a judge's quota on a failed settlement.
- Button works, free run remains primary, results clearly labeled as custodial/on-us.
- `npm run typecheck && npm test && npm run build` green. No protocol/contract changes.
