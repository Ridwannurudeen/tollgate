# Codex scope — one-step email signup-or-login (passwordless)

Today the ONLY way to create an Aperture account is to register a photo at `/link` (`handleLinkRegistration` creates the account as a side effect). `/login` only works for accounts that already exist — a brand-new user can't "enter email → get in" without first listing a photo. Fix it the standard way (Substack/Notion/Medium): the `/login` email box becomes **sign-in OR sign-up** — enter email → magic link → if the email is new, clicking the link **creates the account** and logs in; if it exists, it just logs in. One box, uniform privacy response, no photo required first.

All in `aperture/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build`. Do NOT touch payment/x402/download/fee-router/license-gate/nginx/preview/citations-summary code.

## Verified current wiring (build on this exactly)
- `src/lib/onboarding.ts` `registerCreator({ ownerId, displayName, email?, wallet?, walletSetId?, accountKeyHash? })`: with no `wallet` it **mints a custodial Circle W3S wallet** (needs `CIRCLE_WALLET_SET_ID`, already set in prod — the photo-registration path uses it today), persists `email` lowercased. `displayName` is required (throws if empty).
- `src/lib/account.ts`: `normalizeAccountEmail`, `findOwnerByEmail`, `generateLoginToken(ownerId)` (stores hash on the entry), `redeemLoginToken(token)` (64-hex, single-use, clears on redeem), `signSession`, `sessionCookieOptions`, `sessionSecret()` + the HMAC helpers, `SESSION_COOKIE_NAME`.
- `src/app/api/login-link/route.ts`: current flow = findOwnerByEmail → if found, generate login token + `sendLoginLinkEmail`; always returns uniform `{ ok: true }`; rate-limited; Host-allowlisted `loginOrigin`.
- `src/app/login/verify/[token]/route.ts`: redeems a login token → sets session → redirects to `/dashboard`; 503 if `APERTURE_SESSION_SECRET` unset; invalid → "link expired" page.
- `src/lib/mailer.ts`: `sendLoginLinkEmail(to, url)` via Resend `fetch`, fails closed.

## Design — signup token is STATELESS (no account exists yet to store it on)
Login tokens store a hash on the owner entry; a signup has no entry yet, so use a **self-contained signed token**.

### `src/lib/account.ts` (add)
- `generateSignupToken(email: string): string | null` — returns null if `sessionSecret()` is unset. Payload = `{ email: normalized, exp: now + 20min }`; token = `base64url(JSON.stringify(payload)) + "." + hmacSha256(base64urlPayload, secret)`. Uses the SAME HMAC/secret as sessions.
- `verifySignupToken(token: string): string | null` — split on ".", recompute HMAC (constant-time compare), parse payload, check `exp > now`, return the normalized `email` or null. Reject anything malformed.
- These are distinguishable from login tokens by shape: `redeemLoginToken` already requires `/^[0-9a-f]{64}$/i` and returns null otherwise, so a signup token falls through to `verifySignupToken`.

### `src/app/api/login-link/route.ts` (modify)
- After normalizing email and rate-limiting: `const owner = await findOwnerByEmail(email)`.
  - **If owner exists:** existing path — `generateLoginToken`, `sendLoginLinkEmail(owner.email, verifyUrl)`.
  - **If NOT:** `const token = generateSignupToken(email)`; if token (secret set), `sendSignupLinkEmail(email, `${loginOrigin}${basePath}/login/verify/${token}`)`.
- **Always** return uniform `{ ok: true }` (anti-enumeration preserved — response identical for new vs existing; only the email *content* differs, which only the inbox owner sees).

### `src/lib/mailer.ts` (add)
- `sendSignupLinkEmail(to, url)` — same Resend `fetch`, fails-closed pattern as `sendLoginLinkEmail`, but subject/body say "Confirm your email to create your Aperture creator account" and note the link expires in 20 minutes and to ignore it if they didn't request it. Escape the URL (existing `escapeHtml`).

### `src/app/login/verify/[token]/route.ts` (modify)
- Keep the `APERTURE_SESSION_SECRET` fail-closed 503 check.
- `const owner = await redeemLoginToken(token)` → if owner, existing login path (set session, redirect dashboard).
- **Else** `const email = verifySignupToken(token)`:
  - If null → existing "link invalid or expired" page.
  - If email → **idempotent create-or-login** under the registry write lock semantics:
    - Re-check `findOwnerByEmail(email)`; if an account now exists (someone clicked a prior link / race) → just log into it (set session, redirect) — do NOT create a duplicate.
    - Else `registerCreator({ ownerId: `link-${randomUUID()}`, displayName: <derived>, email })` — no `wallet` (mints custodial), no `accountKeyHash` (email-only login; the account key is optional and not issued here). `displayName` derived from the email local part (`email.split("@")[0]`, trimmed, capped ~80 chars, fallback `"New creator"` if empty).
    - Wrap the `registerCreator` call in try/catch: on failure (e.g. Circle mint error) render a clear "couldn't create your account, request a new link" error page (status 503) — never a raw 500, never a half-created session.
    - On success: `signSession(newOwner.ownerId)`, set cookie, redirect to `/dashboard`.

### `/login` page + nav copy (`src/app/login/page.tsx`, `SiteNavLinks.tsx`)
- Reframe the email box heading/subtext to make it clear it's sign-in **or** sign-up, e.g. "Enter your email — we'll send a link to sign in, or create your account if you're new." Button stays "Send login link" (or "Send link").
- Keep the "Have an account key instead?" backup disclosure unchanged.
- Optional: rename the nav item "Log in" → "Sign in" for logged-out users (one-word copy change in `SiteNavLinks`), since it now also signs up. Skip if it complicates the auth-aware logic.

## Tests
- `generateSignupToken`/`verifySignupToken`: round-trip returns the email; expired token → null; tampered payload or HMAC → null; malformed → null; secret unset → generate returns null / verify returns null.
- `POST /api/login-link`: unknown email → uniform `{ok:true}` and the **signup** mailer is called (mock mailer, assert signup path); known email → login mailer; both uniform; rate-limit trips.
- `GET /login/verify/[token]`: valid signup token for a NEW email → calls `registerCreator` (mock), sets session, redirects dashboard; signup token whose email ALREADY exists → logs into the existing account, does NOT create a duplicate; a normal login token still works; `registerCreator` throwing → 503 error page, no session set; invalid/expired → error page.
- Account created via signup has `email` set, `accountKeyHash` absent, and a wallet (mock the mint in tests).

## Security invariants
- Anti-enumeration preserved: `/api/login-link` returns an identical response for new vs existing emails; the account is created only when the emailed link is clicked (a verified inbox), never from the typed email alone — so typos/spam don't mint accounts or wallets.
- Signup token: HMAC-signed with the session secret, 20-min expiry, carries only the email (no secret material), constant-time verified, fails closed if the secret is unset.
- Idempotent: replaying a signup link (or racing two) never creates duplicate accounts for one email.
- Rate-limited via the existing `/api/login-link` limiter.
- No new dependency.

## Operator tasks
None — reuses the live Resend + `CIRCLE_WALLET_SET_ID` + `APERTURE_SESSION_SECRET` already in `/etc/aperture.env`.

## Acceptance
- A brand-new user can go to `/login`, enter an email they've never used, click the emailed link, and land in a working (empty) dashboard with a minted wallet — no photo registration required first.
- An existing user entering their email gets the login link and logs in (unchanged).
- Response is uniform for new vs existing emails; no duplicate accounts on replay; account only created on verified click.
- `npm run typecheck && npm test && npm run build` green. No new dependency. No payment/gate/citations changes.
