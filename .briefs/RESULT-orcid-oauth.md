# ORCID OAuth verification result

## What changed

- Added optional DOI registration to `CreatorSource` and
  `SourceRegistrationInput`. Catalog registration normalizes DOI URL/prefix and
  case variants to a bare lowercase identifier and persists the result.
- Added `orcid` to `SourceOwnershipProof.method` and made a successful ORCID
  proof clear probation and set `verifiedCreator`, matching meta-tag/DNS trust.
- Added an env-gated OAuth `/authenticate` round-trip:
  - start route issues random state in a signed, short-lived, source-bound
    HttpOnly/Secure/SameSite=Lax cookie;
  - callback verifies state, exchanges the code server-side, and stores only
    the returned normalized ORCID iD in a second signed, source-bound cookie;
  - completion verifies the DOI against that session identity, persists the
    proof, and calls the existing escrow-release path.
- Added the DOI field and env-gated ORCID action to the existing registration
  and source-verification UI.
- Added `ORCID_CLIENT_ID` and `ORCID_CLIENT_SECRET` to `.env.example`. With
  either unset, the start/callback/completion routes return disabled and the UI
  action is absent.
- Updated `docs/ROADMAP.md` and reconstructed
  `docs/SCOPE-ORCID-VERIFICATION.md` to leave client registration as the only
  remaining operator task.

## Verification observed

Run from `citations/` on 2026-08-24:

- `npm test` — passed: 71 test files, 413 tests.
- `npm run typecheck` — passed with no TypeScript errors.
- `git diff --check` — passed before the final documentation update; rerun at
  commit time.
- The original `src/lib/orcid.test.ts` remained unchanged and all 12 tests
  passed.
- ORCID tests use injected fetch fixtures; no live ORCID network call was made.

Coverage added for DOI persistence, OAuth token exchange, OAuth state mismatch,
source-bound session identity, unmatched DOI guidance, env-unset disabling,
probation clearing, caller-supplied-iD rejection, completion without a valid
session, and escrow release after successful verification.

## How session binding is structurally enforced

The public JSON verification route explicitly rejects `method: "orcid"`, so an
ORCID iD in request JSON never reaches catalog verification. The ORCID granting
function, `verifySourceByOrcidSession`, has no ORCID-iD parameter. It accepts a
source and the opaque signed session cookie, verifies the HMAC and expiry,
requires the cookie's source id to equal the source being verified, and extracts
the normalized iD internally. Only the OAuth callback can create that cookie,
and it does so from the server-side token-exchange response after validating the
signed, source-bound OAuth state.

## Assumptions and limits

- The referenced scope document was absent from the worktree and git history.
  `docs/SCOPE-ORCID-VERIFICATION.md` is ignored by the repository's existing
  `**/docs/SCOPE-*.md` rule, so it was reconstructed from the supplied build
  brief, the roadmap, and the verified code. It remains an ignored working
  document by repository convention.
- No ORCID credentials exist, so the real authorization redirect, client
  registration, token response, and production callback could not be exercised.
  The exchange was verified only against an injected response fixture.
- This implements the brief's stated trust model: an authenticated ORCID record
  that lists the DOI is accepted as strong verification. It does not
  independently cross-check publisher/Crossref/DataCite author metadata; ORCID
  users can manually add works to their records.
- Escrow release deliberately reuses the existing DNS/meta-tag path exactly as
  requested. Its pre-existing payment-before-ledger-finalization ordering and
  cross-process idempotency were not changed in this feature.
