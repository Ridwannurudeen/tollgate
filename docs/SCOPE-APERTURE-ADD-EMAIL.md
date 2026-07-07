# Codex scope — let a logged-in creator add a recovery email later

Real gap confirmed: `dashboard/page.tsx:171-176` only DISPLAYS `owner.email` (masked) or "No email login on file" — there is no way for an already-logged-in creator to add one. Every one of the 3 pre-existing real creators (registered before email login existed) and anyone who skipped the optional field at registration is permanently stuck on account-key-only login. Standard product UX (GitHub, Stripe, etc.) lets you add contact info from account settings, not just at signup.

All in `aperture/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build`. Do NOT touch payment/x402/download/fee-router/license-gate/nginx/preview/citations-summary code.

## Verified reuse points
- `src/lib/account.ts`: `normalizeAccountEmail(value)` (lowercase/trim/format-validate, returns `string | null`), `maskAccountEmail(email)`, `getSessionOwner()`.
- `src/lib/registry.ts`: `withRegistryWriteLock`, `readWalletRegistry`, `writeWalletRegistry`, `findWalletForOwner`. Mirror the exact update pattern already used in `src/app/api/account/wallets/route.ts` (session check → validate → atomic map-and-write under the lock → return result).
- `WalletRegistryEntry.email?: string` already exists on the type (`types.ts`) — no new field needed.

## Build

### `POST /aperture/api/account/email` (new route, session-gated)
- `getSessionOwner()`; no session → 401.
- Body `{ email }`; `normalizeAccountEmail(email)`; invalid/missing → 400 `{ error: "a valid email is required" }`.
- **If the owner already has an email on file, reject** (400 `"email already set — this account already has a recovery email"`) — this endpoint is for creators with NO email yet, not an email-change flow (out of scope; avoids needing re-verification logic).
- **Reject if another account already uses this email** (look up via a registry scan comparable to `findOwnerByEmail` in `account.ts` — reuse it) → 409 `"that email is already in use"`.
- On success: under `withRegistryWriteLock`, update the owner's entry with the normalized email, write, return `{ email: maskAccountEmail(email) }`. No verification email needed — the session itself already proves control of the account.

### Dashboard UI (`src/app/dashboard/page.tsx` + a small new client component, e.g. `AddEmailForm.tsx`)
- Where the existing "Login email" row shows "No email login on file", replace that branch with a small inline form: an email input + "Save" button, posting to `POST /api/account/email`.
- On success, show the masked email in place of the form (no full page reload needed — client component manages its own state, or a simple router refresh).
- On error, show the returned message inline (e.g. "that email is already in use").
- Match existing dashboard styling/patterns (see `LinkedWalletsForm.tsx` for the established form-on-dashboard convention: client component, fetch POST, inline status message).

## Tests
- `POST /api/account/email`: no session → 401; invalid email format → 400; owner already has email → 400 (no overwrite); email already used by another owner → 409; success → email persisted (verify via `readWalletForOwner`) and response is masked, never plaintext... actually plaintext is fine here since it's the owner's own email they just typed (not a leak) — return `{ ok: true, email: maskAccountEmail(email) }` for consistent display, but do not need to hide it from the owner themselves.
- Dashboard: renders the add-email form when `owner.email` is absent; renders the masked email display (unchanged) when present.

## Security invariants
- Session-gated (only the logged-in owner can add their own email — never an arbitrary ownerId from the request body).
- One-email-per-account enforced (uniqueness check against the whole registry).
- No email leaves this account's own session response beyond the standard masked display used elsewhere (public/proof/browse outputs already strip email — unchanged).
- No new dependency.

## Operator tasks
None — no env/infra change, reuses the already-live Resend setup for the *next* login-link send (nothing to configure here).

## Acceptance
- A creator with no email on file can add one from `/dashboard` while logged in, without any extra verification step.
- A creator who already has an email cannot silently overwrite it via this endpoint.
- Two accounts cannot share the same email.
- Immediately after adding, that email works with the existing `/login` magic-link flow (manual/live check, not just unit tests).
- `npm run typecheck && npm test && npm run build` green. No new dependency. No payment/gate/citations-summary changes.
