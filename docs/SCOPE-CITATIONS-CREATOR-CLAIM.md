# Codex scope — "Creator-claimed" tier (lighter self-serve verification)

For sources whose content is hosted somewhere the creator doesn't control (a third-party journal PDF, a social post) AND whose creator is custodial (no browser wallet to sign with), NONE of the existing methods work: meta-tag (no HTML to edit), DNS-TXT (no domain), wallet-signature (no key). Add a deliberately-lighter **self-attestation claim** so those creators can self-serve — clearly badged as *claimed, not verified*.

**This is a conscious security trade-off — do NOT paper over it.** The wallet-signature hardening deliberately made only domain proof (meta-tag/DNS) release escrow, to stop a registrant claiming someone else's URL and diverting payouts. A self-attestation claim RELAXES that: it releases escrow on the registrant's word alone, with no proof. Mitigation is transparency only. Therefore:
- A claim MUST set a NEW, lesser status — NEVER `verifiedCreator: true`. The strong "verified" badge stays reserved for domain proof (and future ORCID), so the exploit stays closed for that tier.
- The UI MUST badge claimed sources distinctly and honestly ("Creator-claimed — self-attested by the registrant, not independently verified"). It must never read as "verified."

All in `citations/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build` in `citations/`. Do NOT change x402/settlement/fee-router logic; escrow release reuses the existing `releaseEscrowForSource`.

## Verified current code
- `citations/src/lib/types.ts`: `CreatorSource` has `verifiedCreator: boolean`, `probation?: boolean`, `ownershipProof?: SourceOwnershipProof` (method union already includes `"operator-approved"`, `"seed-demo"`).
- `citations/src/lib/catalog.ts`: `updateSourceVerification(sourceId, ownershipProof)` — sets `verifiedCreator: true, probation: false` ONLY when `method` is `meta-tag`/`dns-txt`; else records the proof only. `verifySourceOwnership(sourceId, body)` validates a wallet-signature and delegates there.
- `citations/src/app/api/sources/[sourceId]/verify/route.ts` PATCH: `method === "meta-tag" | "dns-txt"` → `verifySourceByWebProof`; else → `verifySourceOwnership`; then `releaseEscrowForSource(result.source)`.
- `citations/src/lib/escrow.ts` `releaseEscrowForSource(source)` — releases escrowed payouts; check its gating condition (it keys off verified/probation) and make it ALSO release for a claimed source (probation cleared).
- `citations/src/components/SourceVerifyPanel.tsx`: the verify UI (meta-tag / DNS buttons today). Add the claim action here.
- The badge that renders "verified" status — find it (likely near the source profile / `creators/[wallet]` or a source card) and add the distinct "Creator-claimed" badge.

## Build
1. **Status field** (`types.ts`): add `creatorClaimed?: boolean` to `CreatorSource`. It is SEPARATE from `verifiedCreator`. Add `"creator-claimed"` to the `SourceOwnershipProof.method` union.
2. **Claim logic** (`catalog.ts`): add `claimSourceAsCreator(sourceId, input, filePath?)`:
   - Load the source. Require a minimal attestation payload (e.g. `{ attest: true }`) — reject if not present (forces an explicit "I certify I own this" action, not an accidental click).
   - Under `withRegistryLock`, set `creatorClaimed: true`, `probation: false` (releases escrow), and `ownershipProof: { method: "creator-claimed", verifiedAt: <now> }`. **Do NOT set `verifiedCreator`** — it stays whatever it was (false for these).
   - Return `{ source, sources }` like `updateSourceVerification`.
3. **Route** (`verify/route.ts`): handle `method === "creator-claimed"` → `claimSourceAsCreator(sourceId, body)`, then the existing `releaseEscrowForSource(result.source)`. Keep the meta-tag/dns/wallet-signature branches unchanged.
4. **Escrow** (`escrow.ts`): ensure `releaseEscrowForSource` releases when `probation === false` regardless of `verifiedCreator` (so a claimed-but-not-verified source releases). Verify this doesn't unintentionally change behavior for other states — a wallet-signature-only source still has `probation: true`, so it stays held; only an explicit claim (or domain proof) flips probation.
5. **UI** (`SourceVerifyPanel.tsx`): add a third action, visually subordinate to the domain methods: a checkbox "I certify I am the creator/owner of this work" + a "Claim as creator" button → PATCH `{ method: "creator-claimed", attest: true }`. On success show "Claimed — self-attested." Copy must state plainly this is a self-declaration that releases escrowed payouts but is NOT independent verification, and that domain or ORCID verification is the stronger path.
6. **Badge**: wherever a source shows "Verified creator", render three honest states: **Verified** (green, `verifiedCreator`), **Creator-claimed** (amber/neutral, `creatorClaimed && !verifiedCreator` — tooltip "self-attested by the registrant, not independently verified"), **Unverified** (grey). Claimed must never reuse the green verified styling/label.

## Tests
- `claimSourceAsCreator`: with `attest:true` sets `creatorClaimed:true`, `probation:false`, records `creator-claimed` proof, and does NOT set `verifiedCreator`; without attestation → rejected.
- route: `method:"creator-claimed"` claims + releases escrow; meta-tag/dns still domain-verify; wallet-signature still records proof WITHOUT releasing (probation stays true → escrow held) — regression guard that the hardening still holds for wallet-signature.
- escrow: a claimed source (probation false, verified false) releases; a wallet-signature-only source (probation true) does not.
- badge/UI: claimed renders the distinct badge, never the verified one.

## Security invariants (non-negotiable)
- `verifiedCreator` remains gated to domain proof only — the diversion exploit stays closed for the "Verified" tier.
- Claimed status is visibly, honestly distinct in every surface (badge, panel, tooltip) — never labeled or styled as "verified."
- Wallet-signature-only sources still do NOT release escrow (do not regress the earlier fix).
- No change to x402/settlement/payment-amount logic.

## Acceptance
- A custodial creator with third-party-hosted content can self-serve a "Creator-claimed" status that releases their escrowed payouts, without a wallet, domain, or HTML edit.
- It is badged honestly everywhere as self-attested, never as verified; the "Verified" tier still requires domain proof.
- Wallet-signature-only sources remain escrow-held (earlier hardening intact).
- `npm run typecheck && npm test && npm run build` green. No new dependency. No payment logic changes.
