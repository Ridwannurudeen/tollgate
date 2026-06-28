# Judges

## Five-Minute Path

1. Start at `https://tollgate.gudman.xyz/core`.
2. Open the Citations app and run a paid answer.
3. Open the answer proof and confirm reader payment, creator payouts, retained amount, utilization, and receipt hashes.
4. Open `/proof` and inspect latest receipts, settlement modes, TrackRecord, Covenant, SlashBond, and FeeRouter evidence.
5. Open `/aperture` and inspect the photo-licensing proof surface.

## What To Look For

- x402 payment requirement and reader-payment evidence.
- Hash-linked receipt chain with previous/current hashes.
- Per-creator payout evidence and Arc transaction links when settlement is routed.
- Explicit labels for local-proof, verified, settled, and forum-routed modes.
- Seed/internal traction separated from external creator traction.

## Local Verification

```bash
cd citations
npm test
npm run typecheck
npm run build
npm run verify:ledger
npm run export:proof-pack

cd ../aperture
npm test
npm run typecheck
npm run build
npm run verify:ledger
npm run check:live
npm run export:proof-pack

cd ..
node scripts/export-proof-pack.mjs
```

## Limits

Credentialed settled runs require facilitator/Gateway credentials and are not run from a clean local checkout. Aperture's local proof unlock path is explicit and must not be described as `x402-settled`.
