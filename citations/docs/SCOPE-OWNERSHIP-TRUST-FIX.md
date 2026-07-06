# Codex scope — stop wallet-signature self-attestation from granting full trust

**Confirmed live exploit:** `POST /api/sources` forwards the raw body straight into `appendSource` with no field filtering. Anyone can register a URL they don't own, sign the ownership message with their OWN wallet (proves wallet control, NOT content control), and get `verifiedCreator: true` instantly. This bypasses the escrow-by-default fix and the 1-per-query probation cap built earlier — a real creator's citation payout could be diverted to an attacker's wallet.

**Constraint that must not break:** your three real external creators (CitePay Markets, qdee, Rising Technology) are ALL currently verified via `wallet-signature` (verified live in `data/sources.json`). This fix must NOT retroactively touch existing records — it only changes what future `appendSource`/`verifySourceOwnership` calls are allowed to do. Do not write any migration/backfill script that revisits existing sources.

**Also fixed today (context, not your task):** `TOLLGATE_VERIFY_SECRET` was missing in prod, so the secure domain-proof method (meta-tag/DNS-TXT) was completely non-functional — the site showed "Verification tokens are not configured." It's now set and confirmed working (`GET /api/sources/:id/verify` returns a real token). This scope is what makes that fix meaningful — right now wallet-signature is the *only* thing anyone can actually use to gain trust, which is the problem.

All paths relative to `citations/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build`. Do NOT touch x402/settlement wire code, fee-router payout logic, or contracts — this is registration/verification trust logic only.

## The exact two choke points (both confirmed by reading the code)

1. **`src/lib/catalog.ts` `appendSource`** (~lines 823-836): sets `verifiedCreator: ownershipProof !== undefined`. But `ownershipProofFromInput` (the only function that produces a proof at registration time) can ONLY ever return `method: "wallet-signature"` — domain-proof is not possible at registration (it requires a separate token-placement step). So registration-time proof should never grant full trust.

2. **`src/lib/catalog.ts` `updateSourceVerification`** (~lines 868-897, called by both `verifySourceOwnership` for wallet-signature and indirectly for `verifySourceByWebProof`'s meta-tag/dns-txt results via the `PATCH /api/sources/[sourceId]/verify` route): unconditionally sets `verifiedCreator: true, probation: false` for ANY `ownershipProof`, regardless of `.method`.

## Fix

### 1. `appendSource` — never grant full trust from registration-time proof
Change lines ~837-838 from:
```ts
verifiedCreator: ownershipProof !== undefined,
probation: ownershipProof === undefined,
```
to always:
```ts
verifiedCreator: false,
probation: true,
```
Still spread `...(ownershipProof ? { ownershipProof } : {})` — keep storing the wallet-signature proof as evidence (it's legitimate confirmation of the payout wallet), it just must not flip the trust flags. A registrant who supplies `ownershipSignature` at registration now correctly lands in probation/escrow, same as one who doesn't — they must complete real domain-proof via `/verify` to earn trust.

### 2. `updateSourceVerification` — gate full trust on proof method
Change the signature to also receive (or derive) the method, and branch:
```ts
const source: CreatorSource = {
  ...customSources[index],
  ...(ownershipProof.method === "meta-tag" || ownershipProof.method === "dns-txt"
    ? { verifiedCreator: true, probation: false }
    : {}),
  ownershipProof,
};
```
i.e. `wallet-signature` proofs update the stored `ownershipProof` (so the payout-wallet confirmation is recorded / re-recorded) but do NOT touch `verifiedCreator`/`probation` — they stay whatever they already were (still `false`/`true` from registration, per fix #1, unless a prior domain-proof already verified them). `meta-tag`/`dns-txt` proofs set full trust, exactly as today.

Check `SourceOwnershipProof`'s type in `src/lib/types.ts` to confirm `method` is always present on the object (it should be, per `proof()` in `source-verification.ts` and the return of `ownershipProofFromInput` in `catalog.ts`) — if any call site can construct one without `method`, fix that first.

### 3. Verify `verifySourceOwnership` and `verifySourceByWebProof` both flow through the same gated `updateSourceVerification`
`verifySourceOwnership` (wallet-signature path) already calls `updateSourceVerification`. Confirm `verifySourceByWebProof` (`src/lib/source-verification.ts`) ALSO ends up calling the same gated function (trace how the `PATCH /api/sources/[sourceId]/verify` route in `src/app/api/sources/[sourceId]/verify/route.ts` wires `method === "meta-tag" || method === "dns-txt"` to `verifySourceByWebProof` — check whether that function itself calls `updateSourceVerification` or duplicates the trust-flip logic separately; if it duplicates it, make it call the same shared function so there is exactly ONE place that decides trust, not two that could drift).

### 4. UI honesty check (small, only if needed)
`RegisterPanel.tsx`'s confirmation card and `SourceVerifyPanel.tsx` should not claim "verified" for a wallet-signature-only registration. Read both; if either renders a "verified" state purely from `ownershipProof` presence rather than `verifiedCreator`, fix it to key off `verifiedCreator` (the correct field) so the UI can't say "verified" while the record is actually still probationary.

## Tests
- `catalog.test.ts`: `appendSource` with a valid `ownershipSignature` at registration → `verifiedCreator: false, probation: true` (the exploit case — must no longer grant trust), `ownershipProof` still stored.
- `appendSource` with NO ownership fields → unchanged behavior (`verifiedCreator: false, probation: true`, no ownershipProof).
- `verifySourceOwnership` (wallet-signature) on a probationary source → stays `verifiedCreator: false, probation: true` after the call, but `ownershipProof` is updated/stored.
- `verifySourceByWebProof` (meta-tag or dns-txt, mock the fetch/DNS lookup) → `verifiedCreator: true, probation: false`.
- Regression: a source that already has `verifiedCreator: true` from a PRIOR meta-tag verification, if `verifySourceOwnership` (wallet-signature) is called again on it later (e.g. re-confirming a payout wallet) → must NOT get demoted back to `probation: true` — the fix must not accidentally downgrade already-domain-verified sources. Write this test explicitly.
- Escrow interaction: confirm `shouldEscrowCitation`/`escrow.ts` behavior is unaffected structurally (it already keys off `verifiedCreator`, which now correctly stays `false` for wallet-signature-only sources — no change needed there, just confirm with a test that a wallet-signature-"verified" source still escrows).

## Acceptance
- Registering a URL with a self-signed `ownershipSignature` no longer grants `verifiedCreator: true` — the source stays probationary/escrowed exactly like an unverified one.
- Only real domain-proof (meta-tag or DNS-TXT — now functional in prod since `TOLLGATE_VERIFY_SECRET` is set) can release escrow / lift the probation cap.
- CitePay, qdee, and Rising Technology's EXISTING verified status is untouched (no migration touches stored data).
- `npm run typecheck && npm test && npm run build` green. No x402/fee-router/contract changes.
