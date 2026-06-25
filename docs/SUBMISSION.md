# Tollgate — Lepton Agents Hackathon submission notes

> Numbers below are live and growing — **refresh them right before submitting** (`/api/settlement/status`, `/aperture/api/proof`, `/api/sources`). Citation figures re-verified 2026-06-25 (61 queries, 126 forum-routed payouts, chain ok); Aperture figures verified 2026-06-24.

## One-liner
Tollgate is a creator nanopayment **settlement core on Arc**, proven by **two live integrations** into two real communities: **Citations** (AI answers pay the sources they cite) and **Photo licensing** (a self-hosted Immich sidecar pays photographers per download).

## The problem (form: "what user problems are you building for")
Creators aren't paid for how their work is actually *used* — a writer earns nothing when an AI cites their article; a photographer earns nothing when someone downloads their photo. Per-use payments were always too small to clear, so the world defaulted to subscriptions or nothing. Nanopayments on Arc remove that floor, making the real unit — a citation, a download — sellable on its own.

## What we built
- **Settlement core:** x402 per-request payments + **Circle Gateway** gas-free batched settlement + USDC on Arc + a shared on-chain **FeeRouter** that splits to every creator. The reader endpoint is **multi-accept**: browser wallets pay exact (verify), autonomous agents pay via Gateway (batched on-chain settlement) — the server settles against whichever the payer signed.
- **Integration 1 — Citations:** an autonomous agent decides which sources to buy for a question, pays each cited creator on-chain, and grounds the answer only in what it bought. Self-serve creator registration.
- **Integration 2 — Photo licensing (Aperture):** a permissionless sidecar on Immich (~89k-star self-hosted photo server) watches shared-photo downloads and settles a per-download license fee to the photographer — no upstream changes.

## Traction (form: "how many users onboarded") — verified 2026-06-24
- **Citations:** 4 distinct real creators onboarded (LeptonWeb Lab, qdee, CitePay Markets, Rising Technology); **61 queries** processed; **126 on-chain creator-payout receipts** (`forum-routed`) + reader payments (`x402-settled` + `x402-verified`). All verifiable on `testnet.arcscan.app`.
- **Photo licensing:** live on a real Immich instance; per-download settlement proven on-chain (`forum-routed`), idempotent (no double-pay).
- Every payout is real testnet USDC through the same FeeRouter — clickable, not screenshots.

## Circle tool usage
x402 · **Gateway / Nanopayments** (batched reader settlement, live on `/api/paid-query`) · USDC on Arc · on-chain Contracts (FeeRouter + Forum covenant/bond rail) · agent wallets.

## Agentic
The citation agent runs a real multi-step reasoning loop: it **appraises** every candidate source, **allocates** a fixed USDC budget across what it buys, **drafts** an answer grounded only in purchased sources, **self-critiques** that each claim traces to a source it paid for, and **reflects** — buying one more source — when a claim is unsupported. Each step is recorded as an auditable trace (`traceHash`) bound into the answer hash and the Forum TrackRecord, and shown on `/demo` and every answer page. That is full autonomy under an enforceable budget, not keyword automation. **41 of 61 live answers ran the full LLM loop** (verified 2026-06-25). The photo sidecar settles autonomously per real download event.

## Links
- Live (unified): https://tollgate.gudman.xyz/core
- Citations: https://tollgate.gudman.xyz · Photo licensing: https://tollgate.gudman.xyz/aperture
- Proof: https://tollgate.gudman.xyz/proof · https://tollgate.gudman.xyz/aperture (proof) · explorer: https://testnet.arcscan.app
- Repos: **[fill in public GitHub URLs]** — Citations core (`leptonweb`) + Aperture sidecar (`aperture`).
- Video: **[fill in Loom/YouTube <3min link]**

## Pre-submit checklist
- [ ] Rotate `gho_` token + Anthropic key, then push both repos **public**
- [ ] Record the <3-min video (see `docs/VIDEO-SCRIPT.md`)
- [ ] Refresh the traction numbers above
- [ ] Onboard ≥1 real *external* photographer for Aperture (currently owner-controlled wallet)
- [ ] Submit the form (forms.gle/SMqLaw2pMGDe58LFA) — **after your approval**
