# Tollgate

**Creators do not get paid for how their work is actually used.** A writer earns nothing when an AI cites their article; a photographer earns nothing when someone downloads their photo. Per-use payments were always too small to clear, so the world defaulted to subscriptions or nothing. Nanopayments on Arc remove that floor.

Tollgate turns reuse into revenue: one Arc settlement core, six integration surfaces, and proof pages that bind each paid use to a hash-linked receipt.

**Demo video:** https://youtu.be/YyAoYv9AOI0 · **Live:** https://tollgate.gudman.xyz

## Judge path: 5-minute review

1. Open the unified overview: `https://tollgate.gudman.xyz/core`.
2. Run a paid answer on `https://tollgate.gudman.xyz`, then open the generated answer proof.
3. Inspect `https://tollgate.gudman.xyz/proof` for reader-paid, creator-payout, retained, utilization, receipt-chain, and Arc transaction evidence.
4. Open `https://tollgate.gudman.xyz/aperture` — sign up with just an email (no wallet), list a photo or video (paste a link or upload a file directly), and see the watermarked preview + gated pay-to-unlock page it creates.
5. Open the Aperture dashboard (`/aperture/dashboard`) — one login aggregates a creator's Aperture photo/video earnings and Citations citation earnings by wallet, with a withdraw flow for custodial (email-signup) creators to move funds to their own address, and simple buyer/seller messaging on each listing.
6. Open `https://tollgate.gudman.xyz/video/register` for the PeerTube plugin install path — a separate, optional integration for operators already running their own PeerTube instance; most creators use Aperture's direct video upload instead (step 4), which needs no PeerTube install.
7. Open `https://tollgate.gudman.xyz/immich/register`, `https://tollgate.gudman.xyz/jellyfin/register`, and `https://tollgate.gudman.xyz/wordpress/register` for the self-hosted photo, VOD, and publisher onboarding surfaces.

## Traction snapshot (live, refresh via `/api/proof` before submission)

| Metric                  | Live source                          | Value (as of 2026-07-17)          |
| ----------------------- | ------------------------------------- | ----------------------------------- |
| External sources        | `/api/proof` (`traction`)             | 20                                  |
| Seed/fixture sources     | `/api/proof` (`traction`)             | 11                                  |
| Paid queries (total)    | `/api/proof` (`traction`)             | 32                                  |
| Paid queries (independent readers) | `/api/proof` (`traction`)  | 13 across 11 self-funded wallets    |
| Payout receipts         | `/api/proof` (`traction`)             | 480                                 |
| Unique payer wallets    | `/api/proof` (`traction`)             | 13                                  |
| Unique creator wallets  | `/api/proof` (`traction`)             | 14                                  |
| Total test USDC routed  | `/api/proof` (`traction`)             | ~0.7907                             |
| Ledger integrity        | `/api/proof` (`ledger.verification`)  | `ok: true`, 0 issues                |
| Aperture listings       | `/aperture/api/links`                 | 10 (photo + video, link + upload)   |

Every reader-payment wallet is classified (`operator` / `fixture` / `self-funded-cold-human` / …) in committed [`data/actor-classes.json`](./citations/data/actor-classes.json), and `/api/proof` reports independent traction separately from total — we count only independent readers as traction.

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
- Aperture's download gate returns real x402 requirements and supports verified/local-proof unlock tests locally. FeeRouter payout settlement is now live for the Aperture/Immich path (funded payer key configured); settled `x402` runs specifically still need the facilitator/Gateway credentials noted above.
- The PeerTube plugin (`/video`) requires the operator to run their own PeerTube instance with the plugin installed; it is not a self-serve path for a typical creator — use Aperture's direct video upload instead.
- Jellyfin live FeeRouter settlement is currently proven by a fixture PlaybackStart/PlaybackStop replay against the public sidecar endpoint; a real Jellyfin Webhook plugin event is still pending and is labeled as such in `/jellyfin/api/proof`.

## Apps

Tollgate is one settlement core with six integration surfaces on real open-source creator communities — feeds, Aperture photo/video, Immich, PeerTube, Jellyfin, and WordPress. This repo holds them as independent packages:

| Package | Community | What it does | Live / proof |
| --- | --- | --- | --- |
| [`citations/`](./citations) | AI answer engines (feeds/RSS) | An autonomous answer agent buys the sources it cites and pays each creator per citation. | `https://tollgate.gudman.xyz` |
| [`aperture/`](./aperture) | Self-serve creators, plus self-hosted Immich | A self-serve photo/video licensing product (email signup, upload or link, watermarked preview, x402 pay-gate, unified dashboard, withdraw) that also runs as a permissionless sidecar for Immich shared-link downloads. | `https://tollgate.gudman.xyz/aperture` |
| [`aperture/`](./aperture) | Immich (photo library) | The legacy Immich sidecar path watches shared-link archive downloads and maps asset owners to creator wallets. The `immich.gudman.xyz` DNS target is not configured today, so the public surface is Tollgate-hosted and the install path is a co-located Docker sidecar. | [`/immich/register`](https://tollgate.gudman.xyz/immich/register), [`/immich`](https://tollgate.gudman.xyz/immich), `/aperture/api/proof` |
| [`peertube-plugin-tollgate/`](./peertube-plugin-tollgate) | PeerTube (video) | A permissionless PeerTube plugin gates video downloads and exposes config/proof endpoints for per-download USDC routing. The plugin is published as `peertube-plugin-tollgate@0.1.0` and locally validated; the listed Arc tx is shared FeeRouter rail proof, not a completed plugin-triggered payout. Requires the operator to run their own PeerTube instance. | [`/video/register`](https://tollgate.gudman.xyz/video/register), [`/video`](https://tollgate.gudman.xyz/video), FeeRouter routing tx `0x1ed2e7ca...c1a49d` |
| [`jellyfin-sidecar/`](./jellyfin-sidecar) | Jellyfin (VOD) | A Webhook sidecar maps Jellyfin PlaybackStart/PlaybackStop events to watched minutes, hash-linked receipts, and FeeRouter payouts in live mode. Operators register a hosted webhook key, then configure Jellyfin's official Webhook plugin. The current public FeeRouter tx is labeled as a fixture webhook replay until a real Jellyfin plugin event is recorded. | [`/jellyfin/register`](https://tollgate.gudman.xyz/jellyfin/register), [`/jellyfin`](https://tollgate.gudman.xyz/jellyfin), `/jellyfin/api/proof` |
| [`wordpress-plugin-tollgate/`](./wordpress-plugin-tollgate) | WordPress (publishers) | A plugin gates selected posts, calls Tollgate's hosted settlement API, and records paid reads against publisher wallets. | [`/wordpress/register`](https://tollgate.gudman.xyz/wordpress/register), `/api/wordpress/proof` |
| [`pay-per-piece/`](./pay-per-piece) | Third-party integrators, standalone | Published SDK (`npm install tollgate-pay-per-piece`) for routing per-piece creator payments through the same FeeRouter, outside Citations/Aperture entirely. Includes a worked toy-paywall example with a recorded live Arc testnet proof. | [`npm: tollgate-pay-per-piece`](https://www.npmjs.com/package/tollgate-pay-per-piece), [proof](./pay-per-piece/examples/toy-paywall/LIVE-PROOF.md) |

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
