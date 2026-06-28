# Tollgate - Lepton Agents Hackathon Submission Notes

Refresh live numbers immediately before submission. Do not copy stale values forward without rechecking `/api/settlement/status`, `/aperture/api/proof`, `/api/sources`, and the proof-pack exports.

## One-liner

Tollgate is a creator nanopayment settlement core on Arc, proven by two integrations: Citations pays writers when an AI answer cites their work, and Aperture pays photographers when shared Immich photos are downloaded.

## Problem

Creators are not paid for how their work is actually used. A writer earns nothing when an AI cites their article; a photographer earns nothing when someone downloads their photo. Per-use payments were always too small to clear, so the world defaulted to subscriptions or nothing. Nanopayments on Arc make the real unit of use sellable on its own.

## What We Built

- Settlement core: x402 per-request payments, Circle Gateway batching, USDC on Arc, and a shared on-chain FeeRouter that routes creator payouts.
- Citations: an autonomous agent decides which sources to buy for a question, pays each cited creator, and grounds the answer in purchased sources.
- Aperture: an Immich sidecar watches shared-photo downloads and records per-download license receipts without changing Immich upstream.

## Traction

Use `docs/TRACTION.md` as the source of truth. Separate external creators, seed/demo sources, internal-test wallets, paid queries, payout receipts, unique payer wallets, unique creator wallets, and total test USDC.

## Circle Tool Usage

x402, Gateway/Nanopayments, USDC on Arc, and on-chain contracts through the Forum FeeRouter/accountability rail.

## Agentic Behavior

The citation agent appraises candidate sources, allocates a fixed budget, drafts an answer grounded in purchased sources, self-critiques unsupported claims, and can buy an extra source during reflection. The trace is bound into the answer hash and surfaced on proof pages.

## Links

- Unified live overview: `https://tollgate.gudman.xyz/core`
- Citations: `https://tollgate.gudman.xyz`
- Aperture: `https://tollgate.gudman.xyz/aperture`
- Proof: `https://tollgate.gudman.xyz/proof`
- Explorer: `https://testnet.arcscan.app`
- Repo: Tollgate monorepo - `https://github.com/Ridwannurudeen/tollgate` (`citations/` + `aperture/`)
- Video: `[fill in Loom/YouTube <3min link]`

## Pre-submit Checklist

- [ ] Refresh traction numbers from live endpoints.
- [ ] Run credentialed settled proof paths on the VPS.
- [ ] Record the demo video.
- [ ] Confirm no real secrets are committed.
- [ ] Submit only after explicit user approval.
