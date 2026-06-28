# Architecture

## Components

- `citations/`: Next app for paid answers, source registration, x402 payment verification/settlement, FeeRouter creator payouts, receipt proofs, and Forum accountability surfaces.
- `aperture/`: Next app for Immich shared-link download metering, owner-to-wallet registry, license receipts, proof-pack export, and optional FeeRouter payout routing.
- Forum contracts: FeeRouter, TrackRecord, CovenantVault, and SlashBond surfaces already deployed on Arc testnet.

## Core Lifecycle

```text
reader/source/download request
  -> price/payment requirement
  -> payment verification or settlement
  -> source/download resolution
  -> creator payout route
  -> hash-linked receipt
  -> public proof page / proof pack
```

## Citations Lifecycle

```text
question
  -> source appraisal
  -> budget allocation
  -> x402 reader payment
  -> answer grounded in purchased sources
  -> FeeRouter payout evidence per cited creator
  -> TrackRecord/Covenant/SlashBond accountability
```

## Aperture Lifecycle

```text
shared-link license download
  -> x402 payment requirement
  -> payment verification/settlement or explicit local proof
  -> Immich shared-link resolution
  -> approved owner wallet lookup
  -> archive unlock
  -> idempotency check by eventId
  -> optional FeeRouter route or local proof
  -> license receipt / proof pack
```

## Settlement Labels

- `local-proof`: hash-linked local proof, no on-chain settlement.
- `x402-verified`: payment authorization verified.
- `x402-settled`: x402 facilitator/Gateway settlement completed.
- `forum-routed`: creator payout routed through FeeRouter.
