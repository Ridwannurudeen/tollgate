# Codex scope — Aperture creator accounts: login, dashboard, and a public browse page

Three real gaps confirmed by code audit (not speculation):
1. **No discoverability** — nothing lists registered photos; `/link/[id]` is only reachable if you already hold the exact URL. `src/app/api/links/route.ts` has only `POST`, no `GET` list.
2. **No login / account recovery** — identity is `ownerId = link-${randomUUID()}` (`link-registration.ts:140`), never shown to the creator, with no way to prove "these are mine" later.
3. **No per-creator dashboard** — the only earnings view (`/proof`) is a global table of *everyone*, unauthenticated.

**Product decision already made (do not revisit):** login is by **account key** — a one-time secret string issued at registration, works for creators with **no wallet** (the custodial "we make a wallet for you" path is the primary on-ramp, and we are explicitly onboarding **web2 people who do not own a wallet**). No MetaMask, no wallet signing, no SIWE. A creator must be able to register, close the browser, and log back in on another device with only that key.

All in `aperture/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build` in `aperture/`. Do NOT touch payment/x402/download/fee-router/license-gate/nginx/preview code — this is identity, dashboard, and a public index only.

## Deeper structural fix this scope MUST include

Today every photo registration mints a **brand-new** owner: `handleLinkRegistration` generates a fresh `ownerId` each call and `registerCreator` upserts by it — so a creator who registers 3 photos becomes 3 unrelated "creators" with 3 wallets. A dashboard of "all my work" is impossible until registration can attach to an existing account. **Fix:** when a logged-in creator registers, reuse their existing `ownerId`/wallet instead of minting a new one. See Part 2.

## Verified reuse points
- `src/lib/hash.ts` `sha256Hex(value)` → `0x...` — use to hash the account key. Store only the hash.
- `src/lib/registry.ts` — `WalletRegistryEntry` store, `withRegistryWriteLock`, `upsertWalletRegistryEntry`, `findWalletForOwner`, `readWalletRegistry`. Add the account-key field here.
- `src/lib/link-registry.ts` — `readLinks` (full `LinkRecord[]`), `publicLink(link)` → `PublicLinkRecord` (already hides `sourceUrl`/`sourceContentHash`). Reuse both; never expose a raw `LinkRecord` publicly.
- `src/lib/ledger.ts` `summarizeLedger(ledger)` and `readLicenseLedger()` — receipts carry `ownerId`, so per-creator earnings = filter receipts by the session owner.
- `node:crypto` is already used (`hash.ts`) — use it for the session HMAC and key generation. **Do NOT add wagmi, next-auth, jose, iron-session, or any new dependency.**

## Part 1 — Account key + session (`src/lib/account.ts`, new)

- **Key generation:** `generateAccountKey(): string` → `aptr_` + at least 32 bytes of `crypto.randomBytes` hex (≥128-bit entropy). Return the plaintext to the caller ONCE; never persist plaintext.
- **Storage:** add `accountKeyHash?: string` to `WalletRegistryEntry` (`types.ts`) and to the `isRegistryEntry` validator (`registry.ts`) as an optional string. Store `sha256Hex(accountKey)` on the entry at registration.
- **Lookup:** `findOwnerByAccountKey(accountKey, filePath?)` → hash it, scan the registry for a matching `accountKeyHash`, return the `WalletRegistryEntry` or `null`.
- **Session cookie (HMAC, no new dep):** cookie value = `${ownerId}.${hmacSha256(ownerId, APERTURE_SESSION_SECRET)}` using `node:crypto`. `signSession(ownerId)` and `verifySession(cookieValue): ownerId | null` (constant-time compare via `crypto.timingSafeEqual`). Read `APERTURE_SESSION_SECRET` from env; if missing, **fail closed** (session verification returns null, login route returns 503) — never fall back to an empty/hardcoded secret.
- Cookie name `aperture_session`; attributes when set: `HttpOnly; Secure; SameSite=Lax; Path=/aperture; Max-Age=<e.g. 30d>`.
- `getSessionOwner()` helper that reads the cookie via `next/headers` `cookies()` and returns the verified `WalletRegistryEntry | null`.

## Part 2 — Registration attaches to the logged-in account

- `handleLinkRegistration` (and its `LinkRegistrationDeps`) gain an optional `sessionOwnerId?: string`.
- The `/api/links` POST route resolves the session first (`getSessionOwner()`), and passes the owner id in.
- In `handleLinkRegistration`:
  - **If a valid session owner exists:** reuse that `ownerId`; do NOT call `registerCreator` to mint a new wallet — look up the existing entry and reuse its wallet/custody. The new link is stored under the existing `ownerId`. No new account key.
  - **If no session (first-time / logged-out):** current behavior, PLUS generate an account key, store its hash on the new creator entry, and return the **plaintext key once** in the registration response (new field `accountKey?: string` on `LinkRegistrationResult`, set only on account creation).
- After a logged-out registration, the route sets the session cookie for the new owner (so they land already logged in) AND the response surfaces the account key to save.

## Part 3 — Login page + session routes

- `POST /aperture/api/session` — body `{ accountKey }`; `findOwnerByAccountKey`; on match set the session cookie and return `{ ok: true }`; on miss return 401. **Rate-limit** by IP (reuse the existing rate-limit pattern if one exists in aperture; otherwise a small in-memory per-IP counter — cap ~10/min) so the key space can't be probed.
- `DELETE /aperture/api/session` — clear the cookie (logout).
- `src/app/login/page.tsx` — a single "paste your account key" field → POST → redirect to `/dashboard` on success, inline error on 401. Match the paper theme. Add a "Log in" nav link.

## Part 4 — Creator dashboard (`src/app/dashboard/page.tsx`, session-gated)

- `export const dynamic = "force-dynamic"`. On load, `getSessionOwner()`; if null, redirect to `/login`.
- Add `readLinksByOwner(ownerId, filePath?)` to `link-registry.ts` (filter `readLinks().links` by `ownerId`).
- Render for the logged-in creator ONLY:
  - **Their works:** each registered link — title, watermarked preview thumbnail (`/link/[id]/preview` when `hasPreview`), the shareable `/link/[id]` URL with a copy button, price, and `hasPreview` status.
  - **Their earnings:** filter `readLicenseLedger()` receipts by `ownerId`, sum `amountAtomicUsdc` (reuse `summarizeLedger` shape but scoped to this owner), show total USDC routed + receipt count ("licensed downloads").
  - **Account:** displayName, wallet, custody ("wallet we created for you" vs "your wallet"), approvalStatus. A "log out" button (calls `DELETE /api/session`).
  - A one-time **account-key reminder** surfaced right after registration (carry it via the registration response / success card, since we only ever hold plaintext once) — NOT stored or re-displayable later.
- The dashboard must never render `sourceUrl`, `sourceContentHash`, or `accountKeyHash`.

## Part 5 — Public browse / discovery (`src/app/browse/page.tsx`, public)

- This is "where people checking the website see a creator's work."
- Add `listPublicLinks(filePath?)` to `link-registry.ts` → `readLinks().links.map(publicLink)` (newest first). PublicLinkRecord already omits `sourceUrl`/`sourceContentHash`.
- Public page (no auth): grid of all registered works — watermarked preview (or a placeholder when `!hasPreview`), title, photographer `displayName` (join to registry by `ownerId`), price, linking to `/link/[id]`.
- Add a `GET` handler to `src/app/api/links/route.ts` returning `listPublicLinks()` (public projection only) so the grid/data is also API-reachable. Keep the existing `POST` unchanged.
- Add a "Browse" nav link on the homepage and surface a few recent works on the homepage hero panel area if it fits cleanly (optional).

## Tests
- `account.test.ts`: key generation entropy/prefix; hash round-trip; `findOwnerByAccountKey` hit/miss; session sign→verify round-trip; tampered cookie → null; missing `APERTURE_SESSION_SECRET` → verify returns null / fails closed.
- `link-registration.test.ts`: logged-out registration returns a plaintext `accountKey` and stores only its hash; logged-in registration (sessionOwnerId provided) reuses the existing owner/wallet and does NOT mint a new wallet and does NOT return a new key (DI the registry per existing patterns).
- session route: valid key → 200 + cookie; bad key → 401; rate-limit trips after the cap.
- `link-registry.test.ts`: `readLinksByOwner` filters correctly; `listPublicLinks` returns public projections with no `sourceUrl`.
- dashboard/browse: no-session dashboard redirects; browse renders without auth; neither leaks `sourceUrl`/`accountKeyHash`.

## Security invariants (non-negotiable)
- Account key: ≥128-bit entropy, shown once, only its `sha256Hex` persisted, transmitted only over the existing HTTPS origin.
- Session cookie: `HttpOnly; Secure; SameSite=Lax`, HMAC-signed with a constant-time compare, env secret, fail-closed if unset.
- Login rate-limited so the key space can't be brute-forced.
- No public/authenticated response ever includes `sourceUrl`, `sourceContentHash`, or `accountKeyHash`.
- No wallet, MetaMask, or signing required anywhere in this flow — web2 creators with no wallet must complete register → log out → log back in → see their dashboard.

## Operator tasks (NOT Codex)
- Add `APERTURE_SESSION_SECRET` (`openssl rand -hex 32`) to `/etc/aperture.env` on the VPS before deploy; the session routes fail closed without it.
- Deploy + live-verify: register as a walletless web2 creator, save the account key, log out, log back in on a fresh session, confirm the dashboard shows that creator's own works + earnings and nobody else's; confirm the public browse page lists registered works without login and never exposes a source URL.

## Acceptance
- A walletless creator can register, receive a one-time account key, log out, and log back in on another device with only that key.
- Registering again while logged in adds to the SAME account (dashboard shows multiple works under one identity), with no new wallet minted.
- The dashboard shows only the logged-in creator's works, earnings, and account info — never anyone else's, never a source URL.
- A public browse page lets anyone discover registered works and reach each `/link/[id]` page.
- `npm run typecheck && npm test && npm run build` green. No new dependencies. No payment/gate/preview/nginx changes.
