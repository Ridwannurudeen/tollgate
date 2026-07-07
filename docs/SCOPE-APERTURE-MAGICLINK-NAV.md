# Codex scope — Aperture magic-link login (primary) + consistent auth-aware navigation

**Supersedes `SCOPE-APERTURE-EMAIL-RECOVERY.md`.** Same email infra, but email magic-link becomes the PRIMARY login (the web2 standard: type email → click link → in), not just a lost-key fallback. The account key is demoted to an optional backup credential. Also fixes the navigation: today all 11 pages inline their own `topbar` with different links and none reflect login state.

Builds on the shipped account system (`src/lib/account.ts`, commit c7398d9) and the already-scaffolded `/recover` page + `RecoverForm.tsx` (reuse/repurpose them). Email infra is LIVE: `RESEND_API_KEY` + `APERTURE_MAIL_FROM=Aperture <no-reply@send.gudman.xyz>` are in `/etc/aperture.env`, domain verified, test send landed in inbox. Send via `fetch` to `https://api.resend.com/emails` — **no new dependency, do NOT add the `resend` package.**

All in `aperture/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build`. Do NOT touch payment/x402/download/fee-router/license-gate/nginx/preview code.

## Part A — Magic-link login (primary path)

Merge "login" and "recovery" into ONE magic-link flow. Two ways to authenticate:
1. **Email magic link (primary, promoted):** email → emailed link → session. No key needed.
2. **Account key (secondary, existing `/api/session`):** unchanged, kept for creators who gave no email or prefer a key.

### Data (`types.ts` / `registry.ts`)
- `WalletRegistryEntry`: add `email?: string` (lowercased, trimmed; PII — never in public/proof/browse/cross-creator output), `loginTokenHash?: `0x${string}``, `loginTokenExpiresAt?: string`. Extend `isRegistryEntry` (optional; hex via existing `isHexHash`).

### Token + mailer (`src/lib/account.ts` or new `magic-link.ts`; `src/lib/mailer.ts` new)
- `generateLoginToken(ownerId)` → `{ token, hash, expiresAt }`: token = `randomBytes(32).toString("hex")`; `hash = accountKeyHash(token)`; `expiresAt = now + 20 min`. Persist hash + expiry on the entry (single-use).
- `findOwnerByEmail(email)` → first entry whose lowercased `email` matches, else null.
- `redeemLoginToken(token)` → entry whose `loginTokenHash === accountKeyHash(token)` AND not expired; on success clear the token fields (single-use) and return the owner; else null.
- `mailer.ts` `sendLoginLinkEmail(to, url)`: read `RESEND_API_KEY`/`APERTURE_MAIL_FROM`; if missing return false + `console.warn` (never throw, never hardcode). `fetch` POST to Resend; subject/body honest, states the link logs them into Aperture and expires in 20 min, ignore if unrequested; return true on 2xx. No retry.

### Routes
- `POST /api/login-link` (nodejs): body `{ email }`. Rate-limit by IP (new `assertLoginLinkRateLimit`, ~5/min). Look up by email; if found, generate+persist token and `sendLoginLinkEmail(email, `${origin}${basePath}/login/verify/${token}`)`. **Always** respond `{ ok: true }` (anti-enumeration — never reveal which emails exist).
- `GET /login/verify/[token]` (nodejs): `redeemLoginToken`; invalid/expired → clear "link expired, request a new one" page linking back to `/login`. Valid → set session cookie (`signSession(ownerId)`), redirect to `/dashboard`. Single-use, never log the token. (Note: this replaces the recovery scope's key-rotation-on-redeem — normal login must NOT rotate the key. Keep a separate optional "reset key" action out of scope here.)

### Login page (`/login`) — repurpose existing
- Lead with the **email** field: "Enter your email — we'll send you a login link." Submits to `/api/login-link`, then shows the uniform "if that email is registered, a link is on its way."
- Below it, a smaller "Have an account key instead?" disclosure that reveals the existing account-key field (posts to `/api/session` as today). Email is the hero; key is the fallback.
- Fold the old `/recover` into this — `/recover` can redirect to `/login` (same flow now). Keep `RecoverForm` only if reused; otherwise remove it and its route cleanly (no dead code).

### Registration (`link-registration.ts` / `LinkRegistrationForm.tsx`)
- Add optional-but-**recommended** email field on the logged-out (account-creating) branch: label it "Email (so you can log in with just a link)". Validate strict format, store lowercased via `registerCreator` (`email?` on `RegisterCreatorInput`, persisted like `accountKeyHash`). Logged-in re-registration does not collect email.
- Still issue the account key once at account creation (backup credential) — keep the existing one-time key display, but reframe copy: "Backup key — save it, or just use your email to log in."

## Part B — Shared auth-aware navigation + footer (the IA fix)

### `src/components/SiteNav.tsx` (new, server component)
- Calls `getSessionOwner()`. Renders ONE consistent top bar for every page:
  - Left: **Aperture** brand → `/`.
  - Center/primary: **Browse** (`/browse`), **Sell your photos** (`/link`, styled as the primary CTA).
  - Right (auth-aware): logged out → **Log in** (`/login`). Logged in → the creator's `displayName` → **Dashboard** (`/dashboard`) and **Log out** (reuse `DashboardActions` logout / `DELETE /api/session`).
- Highlight the active route (compare current path).

### `src/components/SiteFooter.tsx` (new)
- One footer for every page with the secondary/operator links: **Proof** (`/proof`), **Install** (`/install`), **Onboarding** (`/onboarding`), **Citations app** (`https://tollgate.gudman.xyz`), **Arcscan** (`ARC_EXPLORER_URL`).

### Apply to every page
- Replace the inline `<nav className="topbar">…</nav>` in `page.tsx`, `browse`, `dashboard`, `login`, `link`, `link/[id]`, `proof`, `onboarding`, `install`, `recover` with `<SiteNav />`, and add `<SiteFooter />`. Remove the now-dead inline nav markup (no leftovers). Keep each page's unique hero/body content untouched.
- Result: identical nav everywhere, login state always visible, operator links demoted to footer. `/download` stays unlinked (legacy).

## Tests
- mailer: missing env → false no-throw; mocked 2xx → true; non-2xx → false.
- magic-link lib: generate→hash→redeem happy path; expired → null; wrong token → null; single-use (second redeem → null); login redeem does NOT change `accountKeyHash`.
- `POST /api/login-link`: unknown email → `{ok:true}` + no send; known → token persisted + send (mock mailer); rate-limit trips.
- `GET /login/verify/[token]`: valid → sets session, redirects; invalid/expired → error page, no session.
- registration: logged-out with valid email persists lowercased; invalid rejected; account key still issued; logged-in ignores email.
- SiteNav: logged-out renders "Log in"; logged-in renders displayName + Dashboard + Log out (mock `getSessionOwner`).
- Sanitization: no public/proof/browse/cross-creator output leaks `email`, `loginTokenHash`, `accountKeyHash` (extend existing tests).

## Security invariants
- Email is PII: lowercased, never in public/proof/browse/other-creator output; mask on the owner's own dashboard.
- Magic-link token: ≥128-bit, only hash stored, single-use, 20-min expiry, never logged, HTTPS only.
- `/api/login-link` anti-enumeration (uniform response) + rate-limited.
- Normal magic-link login does NOT rotate the account key.
- Mailer fails closed (no hardcoded key; missing env → no send, uniform success to caller).
- No new dependency; email via `fetch` to Resend REST.

## Operator tasks (NOT Codex)
- Env already set (`RESEND_API_KEY`, `APERTURE_MAIL_FROM`) — no change.
- Deploy + live-verify: register a walletless creator WITH email → log out → `/login` with email → click emailed link → lands in dashboard (no key used). Confirm nav shows displayName + Log out when logged in and "Log in" when out; confirm operator links are in the footer; confirm a no-email creator can still log in with the account key.

## Acceptance
- Email magic-link is the primary, promoted login; account key is an optional backup; both work.
- Every page shares one auth-aware nav; login state is always visible; operator links live in the footer.
- `/api/login-link` never reveals whether an email is registered and is rate-limited.
- No email/token/hash leaks anywhere public.
- `npm run typecheck && npm test && npm run build` green. No new dependencies. No payment/gate/preview/nginx changes.
