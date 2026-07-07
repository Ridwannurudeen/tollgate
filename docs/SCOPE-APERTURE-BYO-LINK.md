# Codex scope — Aperture "bring your own link": pay-gate any photo URL, no Immich account

Today the ONLY way a photographer gets paid is via an Immich account on this community's server. Add the zero-friction alternative: paste the URL of a photo you already host anywhere → get back a Tollgate payment-gated link → share that link; buyers pay a few cents via x402, you're paid on Arc, the download unlocks. No Immich, no migration.

All in `aperture/` (Next.js, basePath `/aperture`, served at tollgate.gudman.xyz/aperture). Read every file before editing; match the reskinned paper theme and existing lib style. Run `npm run typecheck && npm test && npm run build` in `aperture/`. Do NOT touch fee-router/x402 signing internals, the Immich gate (license-check), or nginx/deploy files.

## Verified reuse points (do not re-derive)
- x402 payment gate pattern: `src/lib/license-download.ts` + `src/lib/x402-server.ts` (`buildPaymentRequirements`, `paymentRequiredBody/Headers`, `settleX402`, `PAYMENT_*_HEADER`s). Clone the 402→settle flow, don't reinvent.
- Payout: `routeLicensePayment(wallet, amount)` from `src/lib/fee-router.ts` (FeeRouter, falls back to local-proof evidence when disabled) — same as the watcher/license-download use it.
- Receipts: `appendLicenseReceipt(input)` from `src/lib/ledger.ts`. `LicenseReceiptInput` requires `{eventId, event: DownloadArchiveEvent, sharedLinkId, assetId, ownerId, photographer, amountAtomicUsdc, evidence}` — for links, synthesize: `sharedLinkId = assetId = link.id`, `ownerId = link.ownerId`, `event` built like `license-download.ts downloadEvent()` but with `paymentResource "aperture-link:<id>"` semantics and `rawLine`/`path` reflecting the link route. Must not break `verifyChain` (it hashes whatever receipt you append — check `LicenseReceiptHashPayload`).
- Custodial wallets + registry: `registerCreator` in `src/lib/onboarding.ts` (ownerId + displayName + optional wallet; blank wallet → Circle W3S custodial mint; writes the wallet registry). For BYO-link photographers there is no Immich ownerId — generate a synthetic one: `link-<randomUUID>`, and reuse `registerCreator` unchanged so the registry, custody, approval and proof surfaces all keep working.
- Fee: `APERTURE_LICENSE_FEE_ATOMIC_USDC` (default 2500 = $0.0025) from `src/lib/config.ts`. Use it as the per-download price (no per-link pricing in v1).

## ⚠ Security requirements (the point of this review — arbitrary user URLs are fetched server-side)
1. **Port `safeFetch` from `citations/src/lib/safe-fetch.ts` into `aperture/src/lib/safe-fetch.ts`** (copy the module + its tests, adjust imports). Every fetch of a photographer-supplied URL MUST go through it (blocks loopback/private/link-local/metadata IPs, DNS-rebind check, safe redirects). No exceptions.
2. **Never reveal the source URL before payment.** The public link page and all API responses must strip `sourceUrl` (mirror `publicSource` in citations / the PII-strip in `registry.ts`). After payment, STREAM the bytes through the server (proxy) rather than redirecting, so the origin URL stays hidden.
3. **Bound the stream:** cap the proxied download (e.g. 25 MB) with byte-capped reading (mirror `readCappedResponseText`'s cap-before-decode approach in `citations/src/lib/catalog.ts`, but binary: stream chunks, abort past the cap). Enforce a response `content-type` allowlist: `image/*` only (jpeg/png/webp/gif/avif/tiff). Reject at registration time too (do a HEAD/GET probe via safeFetch when the link is registered; store the observed content-type + a content hash of the first N bytes as registration evidence).
4. **Rate-limit registrations** per IP (mirror the bucket pattern in `citations/src/lib/rate-limit.ts`, e.g. 10/day/IP) and dedupe: same normalized URL registered twice → 409.
5. Registration input validation: http(s) only, URL length cap, title/name length caps.

## Build

### 1. Link registry — `src/lib/link-registry.ts`
JSON file `data/links.json` (same read/write/atomic-rename + in-process lock style as `registry.ts`/`ledger.ts`). Record: `{id (slug/uuid), title, ownerId (synthetic link-<uuid>), sourceUrl, contentType?, sourceContentHash?, priceAtomicUsdc, createdAt}`. Public projection strips `sourceUrl` (+ anything sensitive). Functions: `registerLink`, `readLinks`, `findLink`, `publicLink`. Tests with tmp file paths like `registry.test.ts`.

### 2. Registration — page `/aperture/link` + `POST /aperture/api/links`
Form (match RegisterCreatorForm styling): photo URL, title, photographer name, wallet ("0x… or leave blank" → custodial, same copy as onboarding). Flow: validate → safeFetch probe (content-type image/*, capture hash) → `registerCreator({ownerId: generated, displayName, wallet?})` → `registerLink`. Response: the shareable gated URL `https://tollgate.gudman.xyz/aperture/link/<id>` + custody info. Show it as a copyable success card ("Share THIS link instead of your original").

### 3. Public gated page — `/aperture/link/[id]`
Paper-theme page: title, "Photo by <name>", price, and TWO buttons (see §4) + one plain-English line explaining what's happening in non-crypto words: "Unlock this photo for $0.0025 — paid instantly to the photographer, no signup required." NO source URL, NO preview image in v1 (previews would leak bytes). Include the receipt/proof link after purchase. Handle unknown id → 404 page.

## Project goal — this section governs every buyer-facing decision below
Tollgate's mission is bridging web2 and web3: the app must be usable by someone with zero crypto background, not just crypto-native testers. **Verified: Aperture currently has NO browser payment client at all** (grepped `src/` for `connectArcWallet`/`makePaidFetch`/x402-client — zero matches). Do not ship a "buyer" experience that's just a raw 402 JSON body with instructions — that fails the mission. Two buyer paths, both required:

### 4. Paid download — `POST /aperture/api/links/[id]/download` + TWO buyer buttons

**Shared server logic (one route, same as before):** no payment header → 402 with `buildPaymentRequirements` for `APERTURE_LICENSE_FEE_ATOMIC_USDC` (resource URL = this route); with header → `settleX402`; on success → `routeLicensePayment(photographer.wallet, fee)` (falls back to local-proof evidence exactly like license-download), `appendLicenseReceipt` (synthesized fields per above), then **proxy-stream the photo** via safeFetch with the byte cap + image content-type check, correct `content-type` + `content-disposition: attachment; filename=…` headers. Repeat purchase by another buyer = a NEW receipt + payout (no cross-buyer dedupe). A failed payout after settlement must still deliver the file with local-proof evidence recorded (never take payment and deliver nothing).

**Button A — "Unlock with your own wallet" (crypto-native path).** Port the browser x402 client from citations into Aperture: copy `src/lib/x402-client.ts`'s `connectArcWallet`/`makePaidFetch` pattern (citations already has this working end-to-end) into `aperture/src/lib/x402-client.ts`, adjusted for Aperture's basePath. Wire it exactly like `AskWorkbench.tsx`'s `runPaidQuery`: connect → sign → paid fetch → on success trigger the browser download (reuse the `DownloadArchiveButton.tsx` blob-download pattern). On error, port `paidQueryErrorMessage`'s plain-English mapping (no wallet found → "Install MetaMask or any Arc-compatible wallet"; user rejected → "Payment cancelled"; insufficient balance → point at the Circle faucet) so failures never show raw crypto error text.

**Button B — "Unlock without a wallet" (the web2 bridge — the actual point of this feature).** Port the custodial demo pattern from citations (`src/lib/circle-w3s.ts`'s `w3sSignTypedData`/payer accessors + `src/lib/x402-custodial.ts`'s `createW3SPaidFetch`, and the `/api/paid-query/demo` route shape) into Aperture as `POST /aperture/api/links/[id]/download/demo`. This lets someone with ZERO crypto experience click one button and the payment is signed and settled by a Tollgate-managed Circle W3S wallet, no MetaMask, no seed phrase, no gas. Apply the SAME safety pattern already proven in citations: **hard caps** (reuse the rate-limit bucket pattern: per-IP 2/day, global 30/day, check-then-record so a failed settlement doesn't burn quota) and a **balance guard** (503 "the demo wallet is out of funds" before attempting settlement, never a raw on-chain revert). Be explicit in the UI that this path is funded by Tollgate for demo/bridging purposes (same honest framing as the citations custodial demo — do not imply the buyer's own money moved if it's the shared demo wallet).

Copy tone for BOTH buttons: no jargon. Say "digital dollars (USDC)" not just "USDC" on first mention; say "a small instant payment" not "x402 settlement"; never show a raw error string, tx hash, or JSON body to a buyer — always map through a plain-English helper first (a receipt/tx link is fine to show AFTER success, clearly labeled "proof of payment," but the primary flow and errors must be jargon-free).

### 5. Surfaces
- `/aperture` landing + `/aperture/onboarding`: add the alternative path — "Already host your photos elsewhere? Paste a link instead →  /aperture/link" (one card/line each, no overclaiming).
- `/aperture/proof`: link receipts should appear naturally (they're in the same ledger); verify the rendering handles the synthesized ids gracefully (labels shouldn't say "shared link" for link receipts if that reads wrong — small label tweak ok).

### 6. Tests (dependency-injected, like license-download.test.ts / watcher.test.ts)
- registry: register/dedupe-409/public projection strips sourceUrl.
- registration route: rejects non-image content-type, rejects private-IP URL (safeFetch), rate-limit 11th/day → 429.
- download route: no header → 402 with requirements; settled → payout called, receipt appended, stream capped; >cap aborts; non-image response → error, no payout... (order: probe content-type BEFORE settling payment so a broken source never charges a buyer: resolve/HEAD first, then 402/settle, then stream; if the stream fails AFTER settlement, record the receipt with a failure note and return an error advising retry — do not silently swallow).
- ledger: appended link receipt keeps `verifyChain` valid.
- Button B caps: 3rd demo unlock from one IP within 24h → blocked with the plain-English limit message; drained demo wallet → 503 plain-English message, not a revert; a failed settlement never consumes quota.
- Button A errors never leak raw text: no-wallet/rejected/insufficient-balance all map through the ported plain-English helper.

## Acceptance
- Register any (public, image, http/s) URL with just URL+title+name (wallet optional/custodial) → get a shareable `/aperture/link/<id>`.
- That page shows no source URL and offers BOTH "unlock with your own wallet" and "unlock without a wallet" — a person with no crypto experience can complete a purchase end-to-end using only Button B.
- Settled payment (either button) → photographer paid (FeeRouter or local-proof), receipt in the ledger + on `/proof`, image streamed with correct headers.
- No raw crypto error, tx hash, or JSON body is ever shown to a buyer as the primary message — always plain English first, technical proof secondary and clearly labeled.
- SSRF blocked (private-IP registration rejected), streams byte-capped, image-only enforced, registrations rate-limited + deduped.
- `npm run typecheck && npm test && npm run build` green in `aperture/`. No changes to fee-router/x402 internals, Immich gate, nginx.
