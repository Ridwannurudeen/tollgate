# Tollgate - Lepton Agents Hackathon Submission Notes

Refresh live numbers immediately before submission. Do not copy stale values forward without rechecking `/api/settlement/status`, `/aperture/api/proof`, `/api/sources`, and the proof-pack exports.

## One-liner

Tollgate is a creator nanopayment settlement core on Arc, proven by three integrations on real open-source creator communities: Citations pays writers when an AI answer cites their work, Aperture pays photographers when shared Immich photos are downloaded, and a permissionless PeerTube plugin pays video creators per download.

## Problem

Creators are not paid for how their work is actually used. A writer earns nothing when an AI cites their article; a photographer earns nothing when someone downloads their photo. Per-use payments were always too small to clear, so the world defaulted to subscriptions or nothing. Nanopayments on Arc make the real unit of use sellable on its own.

## What We Built

- Settlement core: x402 per-request payments, Circle Gateway batching, USDC on Arc, and a shared on-chain FeeRouter that routes creator payouts.
- Citations: an autonomous agent decides which sources to buy for a question, pays each cited creator, and grounds the answer in purchased sources.
- Aperture: an Immich sidecar watches shared-photo downloads and records per-download license receipts without changing Immich upstream.
- PeerTube plugin (`peertube-plugin-tollgate`): a permissionless plugin that gates video downloads and routes USDC to the creator through the same FeeRouter; installs from the PeerTube plugin index with no upstream changes. Download gating and the `/proof` receipt chain are validated (see `peertube-plugin-tollgate/demo/VALIDATION.md`); settlement runs through the same Arc FeeRouter as the other integrations, with a plugin-triggered creator payout proven on Arc (FeeRouter.pay tx 0x1ed2e7...a49d), routing USDC to the creator's claimable FeeRouter split.

## Traction

**Three independent external creators onboarded through the public self-serve flow, each cryptographically verified (signed ownership proof) and each cited by the live agent and paid real USDC on-chain via the FeeRouter:** CitePay Markets (~0.115 USDC), qdee / Shadow Float (~0.027), and Rising Technology / Driplet (~0.012). CitePay and qdee completed onboarding **autonomously with their own agents** (claimed balance + registered a new verified source, unaided). Live ledger: 83 queries, 230 payout receipts, ~0.374 USDC routed, integrity `ok` with 0 issues.

Cross-project, agent-to-agent, on-chain interop: Tollgate sent CitePay 5 real x402 paid queries, and acted as the first external sponsor on qdee's Shadow Float V2 (full sponsor→spend→repay→close loop settled on Arc).

Honest boundary: this is real external-creator supply paid on-chain, not broad external reader demand — most query volume is agent/demand-engine driven. Full figures, wallets, and tx hashes in `docs/TRACTION.md`; seed sources and the self wallet are excluded from these counts.

## Circle Tool Usage

x402, Gateway/Nanopayments, USDC on Arc, and on-chain contracts through the Forum FeeRouter/accountability rail.

## Agentic Behavior

The citation agent appraises candidate sources, allocates a fixed budget, drafts an answer grounded in purchased sources, self-critiques unsupported claims, and can buy an extra source during reflection. The trace is bound into the answer hash and surfaced on proof pages.

## Links

- Unified live overview: `https://tollgate.gudman.xyz/core`
- Citations: `https://tollgate.gudman.xyz`
- Aperture: `https://tollgate.gudman.xyz/aperture`
- PeerTube plugin: `peertube-plugin-tollgate/` in the monorepo (README + local Docker demo kit)
- Proof: `https://tollgate.gudman.xyz/proof`
- Explorer: `https://testnet.arcscan.app`
- Repo: Tollgate monorepo - `https://github.com/Ridwannurudeen/tollgate` (`citations/` + `aperture/`)
- Video: `[fill in Loom/YouTube <3min link]`

## Pre-submit Checklist

- [x] Refresh traction numbers from live endpoints (see `docs/TRACTION.md`, verified 2026-07-05).
- [ ] Run credentialed settled proof paths on the VPS.
- [ ] Record the demo video.
- [ ] Confirm no real secrets are committed.
- [ ] Submit only after explicit user approval.
