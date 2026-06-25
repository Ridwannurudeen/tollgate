# Tollgate — a creator nanopayment settlement core on Arc

**Creators don't get paid for how their work is actually used.** A writer earns nothing when an AI cites their article; a photographer earns nothing when someone downloads their photo. Per-use payments were always too small to clear — so the world defaulted to subscriptions, or nothing. Nanopayments on Arc remove that floor.

Tollgate is one **settlement core** with **two live integrations** into two real communities:

- **Citations** — an autonomous answer agent buys the sources it cites and pays each creator per citation. → `https://tollgate.gudman.xyz`
- **Photo licensing (Aperture)** — a permissionless sidecar on self-hosted **Immich** pays photographers per shared-photo download, with no upstream changes. → `https://tollgate.gudman.xyz/aperture`

**Unified overview + live proof:** `https://tollgate.gudman.xyz/core`

## How the core works
- **x402** for the per-request payment; **Circle Gateway** for gas-free **batched on-chain settlement**; **USDC on Arc**; a shared on-chain **FeeRouter** (Forum) that splits to every creator.
- The reader endpoint (`/api/paid-query`) is **multi-accept**: browser wallets pay the `exact` scheme (verified), autonomous agents pay via **Gateway batched** settlement (`x402-settled`). The server settles against whichever requirement the payer actually signed.
- Creator payouts settle on-chain as `forum-routed` receipts in an append-only, hash-linked ledger.

## Verify it's real (not screenshots)
- Settlement status: `https://tollgate.gudman.xyz/api/settlement/status`
- Proof pages: `/proof`, `/core`, `/answers/<queryId>`, `/creators/<wallet>`, `/sources/<sourceId>`
- Every payout has an on-chain reference on the Arc explorer: `https://testnet.arcscan.app`

## API surface (Citations)
- `GET/POST /api/sources` — list / self-register a priced source (creator onboarding)
- `POST /api/query` — run the agent; pay cited creators on-chain
- `POST /api/paid-query` — reader pays (multi-accept: exact or Gateway-batched), then the answer pays creators
- `GET /api/ledger`, `GET /api/receipts/<hash>`, `GET /api/settlement/status`

## Run & verify locally
```bash
npm install
npm run dev          # http://127.0.0.1:3000
npm test             # vitest
npm run typecheck
npm run build
npm run verify:ledger
```

## Arc (testnet)
chainId `5042002` · RPC `https://rpc.testnet.arc.network` · USDC `0x3600000000000000000000000000000000000000` · FeeRouter `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59` · explorer `https://testnet.arcscan.app`

## Repos
- This repo: the settlement core + Citations integration — https://github.com/Ridwannurudeen/tollgate (private until launch).
- Aperture (Immich photo-licensing sidecar): separate repo — **[add public URL]**.

Built for the Lepton Agents Hackathon (Canteen × Circle × Arc). AI usage: see `AI_USAGE.md`.
