# Tollgate

**Creators do not get paid for how their work is actually used.** A writer earns nothing when an AI cites their article; a photographer earns nothing when someone downloads their photo. Per-use payments were always too small to clear, so the world defaulted to subscriptions or nothing. Nanopayments on Arc remove that floor.

Tollgate turns reuse into revenue: one Arc settlement core, three integrations, and proof pages that bind each paid use to a hash-linked receipt.

## Judge path: 5-minute review

1. Open the unified overview: `https://tollgate.gudman.xyz/core`.
2. Run a paid answer on `https://tollgate.gudman.xyz`, then open the generated answer proof.
3. Inspect `https://tollgate.gudman.xyz/proof` for reader-paid, creator-payout, retained, utilization, receipt-chain, and Arc transaction evidence.
4. Open `https://tollgate.gudman.xyz/aperture` — sign up with just an email (no wallet), list a photo or video (paste a link or upload a file directly), and see the watermarked preview + gated pay-to-unlock page it creates.
5. Open the Aperture dashboard (`/aperture/dashboard`) — one login aggregates a creator's Aperture photo/video earnings and Citations citation earnings by wallet, with a withdraw flow for custodial (email-signup) creators to move funds to their own address, and simple buyer/seller messaging on each listing.
6. Open `https://tollgate.gudman.xyz/video` for the PeerTube plugin proof surface — a separate, optional integration for operators already running their own PeerTube instance; most creators use Aperture's direct video upload instead (step 4), which needs no PeerTube install.

## Traction snapshot (live, refresh via `/api/proof` before submission)

| Metric                  | Live source                          | Value (as of 2026-07-07)          |
| ----------------------- | ------------------------------------- | ----------------------------------- |
| External sources        | `/api/proof` (`traction`)             | 20                                  |
| Seed/fixture sources     | `/api/proof` (`traction`)             | 11                                  |
| Paid queries            | `/api/proof` (`traction`)             | 25                                  |
| Payout receipts         | `/api/proof` (`traction`)             | 458                                 |
| Unique payer wallets    | `/api/proof` (`traction`)             | 13                                  |
| Unique creator wallets  | `/api/proof` (`traction`)             | 14                                  |
| Total test USDC routed  | `/api/proof` (`traction`)             | ~0.758                              |
| Ledger integrity        | `/api/proof` (`ledger.verification`)  | `ok: true`, 0 issues                |
| Aperture listings       | `/aperture/api/links`                 | 10 (photo + video, link + upload)   |

Real external adoption: several people outside the founding team found Tollgate through social media and self-served the full creator flow (email signup, upload their own photo/content, no hand-holding) — including one organic cold signup who returned to list a second item, and one person active across both Aperture and Citations. Full detail and honest caveats in [`docs/TRACTION.md`](./docs/TRACTION.md).

## What's in Aperture beyond the original photo sidecar

Aperture started as an Immich shared-link sidecar and has grown into a self-serve creator product in its own right:

- **Passwordless accounts** — sign up with just an email (magic-link, no wallet); a Circle W3S custodial wallet is minted automatically. An account key remains as a backup login method.
- **Direct upload** for both photos and video (no hosting URL required), alongside the original paste-a-link flow (GitHub/Google Drive links auto-normalized). Uploads are validated server-side (`sharp` for images, `ffprobe`/`ffmpeg` for video) and watermarked before any preview is shown publicly.
- **Public browse + gated listing pages** — anyone can see what's registered; the original file stays locked behind an x402 payment.
- **A unified dashboard** aggregating a creator's Aperture earnings and Citations citation earnings in one place, joined by wallet.
- **Custodial withdraw** — creators whose wallet was auto-minted (not self-custody) can withdraw their real balance to any external address they control.
- **Buyer/seller messaging** on each listing for pre- or post-purchase questions.

See [`aperture/README.md`](./aperture/README.md) for the full API surface, including the legacy Immich shared-link path.

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
- Sources whose creator controls neither the content's hosting nor a domain (e.g. a paper on a third-party journal) can't clear meta-tag/DNS verification; a lighter, honestly-badged "creator-claimed" self-attestation tier exists for that case — see `docs/ROADMAP.md`'s verification-ladder section. It never sets the strong `verifiedCreator` flag.
- Public traction numbers must be refreshed from live endpoints before submission; do not infer them from seed data.
- Aperture's download gate returns real x402 requirements and supports verified/local-proof unlock tests locally; settled x402 and FeeRouter payout runs need the facilitator/Gateway and funded Aperture payer credentials.
- The PeerTube plugin (`/video`) requires the operator to run their own PeerTube instance with the plugin installed; it is not a self-serve path for a typical creator — use Aperture's direct video upload instead.

## Apps

Tollgate is one settlement core with three integrations on real open-source creator communities — feeds, photo/video, and video-via-PeerTube. This repo holds them as independent packages:

| Package | Community | What it does | Live / proof |
| --- | --- | --- | --- |
| [`citations/`](./citations) | AI answer engines (feeds/RSS) | An autonomous answer agent buys the sources it cites and pays each creator per citation. | `https://tollgate.gudman.xyz` |
| [`aperture/`](./aperture) | Self-serve creators, plus self-hosted Immich | A self-serve photo/video licensing product (email signup, upload or link, watermarked preview, x402 pay-gate, unified dashboard, withdraw) that also runs as a permissionless sidecar for Immich shared-link downloads. | `https://tollgate.gudman.xyz/aperture` |
| [`peertube-plugin-tollgate/`](./peertube-plugin-tollgate) | PeerTube (video) | A permissionless PeerTube plugin gates video downloads and exposes config/proof endpoints for per-download USDC routing; plugin-triggered creator payout proven on Arc (routes to the creator's claimable FeeRouter split). Published as `peertube-plugin-tollgate@0.1.0`; local-path install remains supported for self-hosted tests. Requires the operator to run their own PeerTube instance. | [`/video`](https://tollgate.gudman.xyz/video), plugin creator-payout tx `0x1ed2e7ca...c1a49d` (truncated; full hash in `peertube-plugin-tollgate`'s own docs) |

**Unified overview + live proof:** `https://tollgate.gudman.xyz/core`

Each integration attaches to a community that already emits settlement-grade events (citations, shared-link downloads, video downloads) and settles against wallets the community's own data structures already encode — no upstream approval required.

## Shared core

- x402 for per-request payment; Circle Gateway for gas-free batched on-chain settlement; Circle W3S custodial wallets for keyless (email-only) creator onboarding; USDC on Arc; a shared on-chain FeeRouter (Forum) that splits to every creator.
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
