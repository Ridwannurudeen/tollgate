# Tollgate

**Creators do not get paid for how their work is actually used.** A writer earns nothing when an AI cites their article; a photographer earns nothing when someone downloads their photo. Per-use payments were always too small to clear, so the world defaulted to subscriptions or nothing. Nanopayments on Arc remove that floor.

Tollgate turns reuse into revenue: one Arc settlement core, three integrations, and proof pages that bind each paid use to a hash-linked receipt.

## Judge path: 5-minute review

1. Open the unified overview: `https://tollgate.gudman.xyz/core`.
2. Run a paid answer on `https://tollgate.gudman.xyz`, then open the generated answer proof.
3. Inspect `https://tollgate.gudman.xyz/proof` for reader-paid, creator-payout, retained, utilization, receipt-chain, and Arc transaction evidence.
4. Open `https://tollgate.gudman.xyz/aperture` for the Immich photo-licensing proof surface.
5. Open `https://tollgate.gudman.xyz/video` for the PeerTube plugin proof surface, then follow any Arc transaction link to `https://testnet.arcscan.app`.

## Traction snapshot

Fill these from live endpoints immediately before submission:

| Metric                 | Live source                              | Value        |
| ---------------------- | ---------------------------------------- | ------------ |
| External creators      | `/api/sources` after seed/internal split | user refresh |
| Seed/internal sources  | `/api/sources` after seed/internal split | user refresh |
| Paid queries           | `/api/settlement/status`                 | user refresh |
| Payout receipts        | `/proof` and `/api/settlement/status`    | user refresh |
| Unique payer wallets   | proof pack export                        | user refresh |
| Unique creator wallets | proof pack export                        | user refresh |
| Total test USDC routed | proof pack export                        | user refresh |

## Top verification commands

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

## Known limitations

- Credentialed `x402-settled` runs require facilitator/Gateway credentials and are user-operated.
- Unverified external sources escrow by default; set `TOLLGATE_ESCROW_UNVERIFIED=0` only for trusted local demos.
- Public traction numbers must be refreshed from live endpoints before submission; do not infer them from seed data.
- Aperture's download gate returns real x402 requirements and supports verified/local-proof unlock tests locally; settled x402 and FeeRouter payout runs need the facilitator/Gateway and funded Aperture payer credentials.

## Apps

Tollgate is one settlement core with three integrations on real open-source creator communities — feeds, photo, and video. This repo holds them as independent packages:

| Package                                                   | Community                     | What it does                                                                                                                                                                                                                                                                                 | Live / proof                                                                                                                                                 |
| --------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`citations/`](./citations)                               | AI answer engines (feeds/RSS) | An autonomous answer agent buys the sources it cites and pays each creator per citation.                                                                                                                                                                                                     | `https://tollgate.gudman.xyz`                                                                                                                                |
| [`aperture/`](./aperture)                                 | self-hosted Immich (photo)    | A permissionless sidecar gates shared-photo downloads with x402 and pays photographers per licensed download, with no upstream changes.                                                                                                                                                      | `https://tollgate.gudman.xyz/aperture`                                                                                                                       |
| [`peertube-plugin-tollgate/`](./peertube-plugin-tollgate) | PeerTube (video)              | A permissionless PeerTube plugin gates video downloads and exposes config/proof endpoints for per-download USDC routing; plugin-triggered creator payout proven on Arc (routes to the creator's claimable FeeRouter split). Published as `peertube-plugin-tollgate@0.1.0`; local-path install remains supported for self-hosted tests. | [`/video`](https://tollgate.gudman.xyz/video), plugin creator-payout tx `0x1ed2e7caa90964100d843095acc4f3e5c5f5bf9203850e91d2cab8f838c1a49d` |

**Unified overview + live proof:** `https://tollgate.gudman.xyz/core`

Each integration attaches to a community that already emits settlement-grade events (citations, shared-link downloads, video downloads) and settles against wallets the community's own data structures already encode — no upstream approval required.

## Shared core

- x402 for per-request payment; Circle Gateway for gas-free batched on-chain settlement; USDC on Arc; a shared on-chain FeeRouter (Forum) that splits to every creator.
- Creator payouts settle on-chain as `forum-routed` receipts in an append-only, hash-linked ledger.
- Arc testnet: chainId `5042002`, RPC `https://rpc.testnet.arc.network`, USDC `0x3600000000000000000000000000000000000000`, FeeRouter `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59`, explorer `https://testnet.arcscan.app`.

## Run either app

Each app is self-contained with its own `package.json`:

```bash
cd citations   # or: cd aperture
npm install
npm run dev
npm test
npm run typecheck
```

See [`citations/README.md`](./citations/README.md) and [`aperture/README.md`](./aperture/README.md) for the per-app API surface and proof commands.
