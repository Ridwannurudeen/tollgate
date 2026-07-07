# Codex scope — Aperture: real download enforcement + photographer onboarding + portability framing

Three deliverables in `aperture/` (Next.js app, basePath `/aperture`). Read every file before editing. Run `npm run typecheck && npm test && npm run build` in `aperture/`. Do NOT change fee-router/x402 signing internals.

## Verified infrastructure facts (do not re-derive; the nginx work is NOT yours — see "division of labor")
- Immich runs on the VPS in docker at `127.0.0.1:2283`. nginx proxies `location ^~ /immich/api/ → 127.0.0.1:2283/api/` with NO gating today — that's the bypass: anyone with a shared-link key can hit `/immich/api/download/archive?key=<key>` free.
- Aperture app runs at `127.0.0.1:3036` behind `location ^~ /aperture/`.
- `aperture-watcher.service` tails the access log and settles payouts post-hoc (that stays — it becomes the recorder/fallback).
- The paid gate `src/lib/license-download.ts` already settles x402 payments and appends per-asset receipts (`appendLicenseReceipt`, keyed by `eventId` built from sharedLink.id + asset.id); on success it returns the raw Immich URL. Receipts live in the license ledger (`readLicenseLedger`).
- The operator (me) will add nginx `auth_request` so every `/immich/api/download/archive` request is sub-requested to a NEW Aperture check endpoint you build. nginx passes the original URI (with `?key=`) in `X-Original-URI` and no request body.

## 1. Build the license-check endpoint (the enforcement brain)

New route: `src/app/api/license-check/route.ts` (GET, runtime nodejs). nginx will call it internally on every archive download with headers `X-Original-URI` (e.g. `/immich/api/download/archive?key=AbC123`) and `X-Original-Method`.

Logic (extract to a testable lib function `evaluateLicenseCheck` in `src/lib/license-check.ts`, route is a thin wrapper):
1. Parse the `key` query param out of `X-Original-URI`. **No `key` param → 204 allow** (that's an authenticated Immich owner/session download, not a shared-link download — never break the owner's own app).
2. `key` present → resolve the shared link via the existing `resolveSharedLink(immichApiBaseUrl, key)` from `src/lib/immich.ts`. If resolution fails (bad key), return 403 (Immich would reject it anyway).
3. For each asset in the link, look up the owner wallet via `readWalletForOwner` (`src/lib/registry.ts`):
   - Owner **not registered or approvalStatus "pending"** → that asset is not payable → it does NOT require a receipt (nothing to pay; don't permanently brick unregistered photographers' links).
   - Owner registered+approved → **payable**: require a receipt in the license ledger whose `sharedLinkId === sharedLink.id && assetId === asset.id` (any settlementMode — forum-routed, x402-settled, or local-proof all count as licensed).
4. Every payable asset has a receipt (or there are zero payable assets) → **204**. Any payable asset lacks a receipt → **402-style deny**: return **403** (nginx auth_request only honors 401/403 as deny; anything else is treated as server error) with a JSON body `{ error: "payment required", pay: "/aperture/api/license-download" }` — the body won't reach the client through auth_request, but keep it for direct calls.
5. Keep it fast: one `resolveSharedLink` call + one ledger read per check. Cache the ledger read per-request only (no long-lived cache — a fresh payment must unlock immediately).

Tests (`src/lib/license-check.test.ts`, dependency-injected like `watcher.test.ts`): no-key → allow; unknown key → deny; all-payable-assets-receipted → allow; one payable asset missing receipt → deny; unregistered-owner assets ignored; pending-approval owner treated as unregistered.

Also: in `license-download.ts`, the success response currently says the URL is open — after the gate, its `downloadRequest.url` remains correct (the receipt now exists, so the gate passes). Verify nothing in it assumes the archive URL is ungated; adjust any copy strings that say the endpoint is unprotected.

## 2. Photographer onboarding — make the real flow explicit (standard fix)

Today `/aperture/onboarding` shows the register form but never explains where photos come from. Add a clear numbered "How photographers get paid" strip ABOVE the form (reuse the existing flow-card styling from the home page):
1. **Get an Immich account** on this community's photo server and upload your photos there (Aperture is a payment sidecar — Immich hosts the photos).
2. **Share your work** with Immich shared links, as normal.
3. **Register below** with your Immich owner ID + payout wallet (or leave the wallet blank and a Circle W3S custodial wallet is created for you).
4. **Every licensed download pays you** USDC on Arc through the FeeRouter, with a verifiable receipt.
Copy tone: plain, creator-first, matching the reskinned paper theme. Also add one line on the landing hero clarifying "a payment sidecar for your Immich photo community" if not already plain.

## 3. Portability framing (standard: roadmap statement, NOT integration claims)

On the Aperture landing page (operator band or below the flow cards), add ONE honest sentence — do NOT name Unsplash/Flickr/500px or claim any integration that doesn't exist:
> "The sidecar pattern is platform-portable: any photo platform that exposes download events can pay its photographers this way. Immich is the live integration today."
Nothing else. No "coming soon" logos, no partner claims.

## Division of labor
- YOU (Codex): the license-check endpoint + lib + tests, license-download copy check, onboarding strip, portability sentence. All inside `aperture/`.
- OPERATOR (not you): nginx `auth_request` wiring on the VPS, deploy, and end-to-end verification (pay → gate opens; no receipt → 403). Do not write nginx config into the repo except OPTIONALLY a commented example snippet in `aperture/deploy/` if one exists there already — check first.

## Acceptance
- `evaluateLicenseCheck` unit-tested for all six cases above; route returns 204/403 with correct header parsing.
- Onboarding page shows the 4-step photographer flow above the form; landing has the portability sentence; no invented integration claims anywhere.
- `npm run typecheck && npm test && npm run build` green in `aperture/`.
- (Operator will then verify live: unpaid archive request → 403; after paying via `/aperture/api/license-download` → same request 200 and the photographer's receipt exists.)
