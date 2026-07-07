# Codex — COMPLETE the BYO-link buyer experience (read WITH docs/SCOPE-APERTURE-BYO-LINK.md)

You built the seller side + the server download gate well (link-registry, registration, content probe, safeFetch, `/api/links/[id]/download` with x402 402/settle/payout/receipt/stream). But **§4 "TWO buyer buttons" was not done** — and that section is the whole point of this feature (bridge web2↔web3, usable by a non-crypto person). Right now `LinkDownloadButton.tsx` just POSTs once, detects 402, and stops — it never actually pays. Complete the following. Everything stays in `aperture/`. Run `npm run typecheck && npm test && npm run build` in `aperture/` before finishing. Do NOT touch fee-router/x402-server internals, the Immich license gate, or nginx.

Verified reuse facts (accurate as of now):
- `aperture/src/lib/circle-w3s.ts` has ONLY `w3sCreateWalletSet` + `w3sMintWallet` — it does NOT have `w3sSignTypedData`/`payerWalletId`/`payerAddress`. You must add them.
- `@x402/core|evm|fetch@^2.17.0` ARE already in aperture's package.json (no new deps needed).
- The server route `POST /aperture/api/links/[id]/download` already returns a proper x402 402 with payment requirements and, given a valid payment header, settles + pays + streams the image. Both buttons drive THIS route (Button A directly with a browser-signed payment; Button B via a new server-side custodial wrapper route). Do not rewrite the download route's payment logic.

## Button A — "Unlock with your own wallet" (crypto-native path)
1. Create `aperture/src/lib/x402-client.ts` by porting `citations/src/lib/x402-client.ts` verbatim in behavior (`connectArcWallet` — window.ethereum, auto-add Arc on 4902; `makePaidFetch(client)` — the exact-scheme EIP-712/3009 signer). Keep the same Arc chain constants (chainId 5042002, USDC `0x3600…`, RPC). If aperture already exports chain constants in `src/lib/chain.ts`, reuse them instead of re-declaring.
2. Port `paidQueryErrorMessage` from `citations/src/components/AskWorkbench.tsx` into a small `aperture/src/lib/pay-errors.ts` (rename generically, e.g. `payErrorMessage(error, priceText)`): no-wallet → "No wallet detected. Install MetaMask (or any Arc-compatible wallet) and try again."; user-rejected/4001 → "Payment cancelled — approve the wallet prompt to unlock the photo."; insufficient balance → point at `https://faucet.circle.com`. Never surface raw error text.
3. Rewrite `LinkDownloadButton.tsx`'s primary button to actually pay: on click → `const client = await connectArcWallet(); const paidFetch = makePaidFetch(client); const res = await paidFetch(\`${basePath}/api/links/${id}/download\`, {method:"POST"})` → on ok, blob-download (the existing blob logic is fine) + show the receipt hash as "proof of payment" (secondary, labeled). On error → `payErrorMessage(...)` inline. Label it **"Unlock with your own wallet"**.

## Button B — "Unlock without a wallet" (THE web2 bridge — custodial, no MetaMask/seed/gas)
This mirrors the citations custodial demo exactly. Port these pieces:
1. Add to `aperture/src/lib/circle-w3s.ts` (reuse its existing internal `request`/`sealEntitySecret`/`requireEnv`): `encodeEip712`, `w3sSignTypedData(walletId, typed, memo)`, `payerWalletId()` (`CIRCLE_PAYER_WALLET_ID`), `payerAddress()` (`CIRCLE_PAYER_ADDRESS`) — copy the exact implementations now in `citations/src/lib/circle-w3s.ts`.
2. Create `aperture/src/lib/x402-custodial.ts` = port of `citations/src/lib/x402-custodial.ts` (`createW3SPaidFetch({walletId,address})` using `@x402/evm` `ExactEvmScheme` + `@x402/fetch` `wrapFetchWithPaymentFromConfig`, signer.signTypedData → `w3sSignTypedData`). Use aperture's ARC CAIP-2 (`eip155:5042002`).
3. Add caps in `aperture/src/lib/link-rate-limit.ts` (it already exists for registration — add to it, following its bucket style) OR mirror `citations/src/lib/rate-limit.ts`'s `assertDemoPaidQueryWithinLimits` + `recordDemoPaidQuery`: per-IP **2/24h**, global **30/24h**, **check-then-record** (record ONLY after a successful settlement so a failure never burns quota). Copy the 4 cap tests from `citations/src/lib/demo-paid-query.test.ts`.
4. New route `POST /aperture/api/links/[id]/download/demo` (runtime nodejs), mirroring `citations/src/app/api/paid-query/demo/route.ts`: guard payer env (unset → 503 "custodial unlock isn't configured"); `requestIp`; `assertDemoPaidQueryWithinLimits(ip)` → 429 plain message; **balance guard** — read the payer's USDC balance (via a public client + the USDC balanceOf abi aperture already uses in fee-router.ts), `< APERTURE_LICENSE_FEE_ATOMIC_USDC` → 503 "the free-unlock wallet is out of funds — try 'unlock with your own wallet'"; then `createW3SPaidFetch({walletId:payerWalletId(), address:payerAddress()})` and POST to `${request.nextUrl.origin}${basePath}/api/links/${id}/download` (server-to-self, preserves the x402 flow). Only `recordDemoPaidQuery(ip)` after a 2xx. Stream the returned image bytes back to the caller (set content-type + content-disposition from the sub-response). On sub-failure → plain-English error, no quota consumed.
5. Second button in `LinkDownloadButton.tsx`: **"Unlock without a wallet"** → POST the `/demo` route → blob-download. Subtext: "paid for you by Tollgate for the demo — no crypto needed." Handle 429/503 by showing the returned plain-English `error` inline. Free run/own-wallet both visible; neither hidden.

## Copy rules (apply to the whole buyer page + both buttons)
No jargon in the primary flow: "digital dollars (USDC)" on first mention, "a small instant payment" not "x402 settlement", never show a raw tx hash / JSON / error string as the main message. A "proof of payment" link AFTER success is fine, clearly labeled. The `/aperture/link/[id]` page must let a total non-crypto person complete a purchase using Button B alone.

## Operator tasks (NOT yours — leave to the human)
- Provision + fund a Circle W3S custodial payer wallet for Aperture and set `CIRCLE_PAYER_WALLET_ID`/`CIRCLE_PAYER_ADDRESS` (+ `CIRCLE_API_KEY`/`CIRCLE_ENTITY_SECRET`) in `/etc/aperture.env`. Until then Button B correctly returns the 503 "not configured" you built the guard for — that's expected, not a bug.
- nginx/deploy/live verification.

## Acceptance (add to the existing scope's acceptance)
- `LinkDownloadButton` renders BOTH buttons; clicking "Unlock with your own wallet" triggers a real browser payment and downloads on success; "Unlock without a wallet" completes a full purchase with no wallet when the custodial payer is configured (503 plain message when not).
- No raw crypto error/tx/JSON shown as a primary message anywhere in the buyer flow.
- Cap tests pass (3rd/day per IP blocked, 31st global blocked, failure doesn't consume quota).
- `npm run typecheck && npm test && npm run build` green in `aperture/`.
