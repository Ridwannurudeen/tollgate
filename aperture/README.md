# Aperture

Aperture is Tollgate's photo/video licensing product. A creator signs up with just an email (no wallet — a Circle W3S custodial wallet is minted automatically), lists a photo or video by pasting a link or uploading a file directly, gets a watermarked preview generated automatically, and gets paid in USDC on Arc the moment a buyer pays to unlock the original.

It also runs as a permissionless sidecar for self-hosted **Immich** photo communities, gating shared-link downloads the same way — that was the original feature; the self-serve product above is what it grew into.

Public path: `https://tollgate.gudman.xyz/aperture`.

## Creator flow (self-serve, no wallet required)

1. **Sign up** at `/aperture/login` with just an email — a magic link creates the account and mints a custodial wallet on first click. An account key is also issued as a backup login method. Self-custody creators can supply their own wallet instead at registration.
2. **List work** at `/aperture/link` — paste a photo/video URL (GitHub blob and Google Drive `/view` links are auto-normalized to raw file URLs) or upload a file directly. Uploads are validated server-side: images via `sharp`, video via `ffprobe`/`ffmpeg` (real decode, not trusting the client's filename/content-type), capped at 25MB (photo) / 100MB (video).
3. A **watermarked preview** (downscaled image, or an extracted+watermarked video thumbnail) is generated and stored; the original is stored separately and never served publicly.
4. The listing appears on `/aperture/browse` and gets its own gated page at `/aperture/link/[id]` — preview and price are public, the original is locked behind an x402 payment.
5. A buyer pays via x402. After verification, Aperture loads the exact original, settles directly to the approved creator, journals the payment, streams the bytes, and appends a hash-chained receipt. A transient receipt outage does not charge the same payment twice or withhold otherwise available paid media.
6. The creator's **dashboard** (`/aperture/dashboard`, session-gated) shows their own listings, Aperture earnings, aggregated Citations citation-earnings for the same wallet (or any wallet they explicitly link), and — for custodial (email-signup) creators — a **withdraw** action to send their real balance to an external address they control. Self-custody creators already hold their funds directly and don't need this.
7. Each listing supports simple **buyer/seller messaging** (`/aperture/link/[id]` message panel + a dashboard inbox) for pre- or post-purchase questions — text-only, session-gated, private per buyer/seller thread.

## Legacy path: Immich shared-link sidecar

The original feature: Aperture resolves Immich shared-link keys to asset owners, returns an x402 payment requirement that pays the approved creator directly, journals the payment, and writes hash-chained payout receipts. After settlement it issues a short-lived, one-use authorization for the exact shared-link archive request. This boundary supports only unpassworded, key-based `INDIVIDUAL` links with downloads enabled, a complete asset selection, and one payout wallet for the whole archive.

### Verified Immich v2.7.5 Flow

The live Immich server emits this sequence for a public shared-link download:

- Page view: `GET /api/shared-links/me?key=<shareKey>`
- Render preview: `GET /api/assets/<assetId>/thumbnail?key=<shareKey>&...`
- Download click: `POST /api/download/info?key=<shareKey>`
- Billable download: `POST /api/download/archive?key=<shareKey>`

Both nginx entry points protect the archive endpoint with Aperture's authorization check. Historical receipts do not unlock a link. The access-log watcher observes successful authorized downloads and correlates them with receipts written by the payment gate; it never settles or appends a second payout.

## Local Development

```bash
npm install
npm run typecheck
npm test -- --run
npm run build
npm run export:proof-pack
```

### Self-serve licensing routes (BYO-link / upload)

- `POST /aperture/api/links` — register a photo/video by URL (JSON body: `sourceUrl`, `title`, `description?`, `displayName`, `wallet?`).
- `POST /aperture/api/links/upload` — register by direct file upload (multipart form: `file`, `title`, `description?`, `displayName`, `wallet?`).
- `GET /aperture/api/links` — public listing feed (powers `/aperture/browse`); never exposes the original source URL.
- `POST /aperture/api/links/[id]/download` — the x402-gated download route; without a payment signature it returns HTTP 402. A valid payment is journaled and settled directly to the approved creator only after the original is available.
- `POST /aperture/api/login-link` / `GET /aperture/login/verify/[token]` — email magic-link signup-or-login.
- `POST /aperture/api/session` — account-key login (backup path).
- `POST /aperture/api/account/email` — disabled unless a verified email-link binding flow is used; caller-provided email alone is never accepted.
- `POST /aperture/api/account/wallets` / `DELETE` — link/unlink an additional wallet for dashboard earnings aggregation.
- `GET`/`POST /aperture/api/account/withdraw` — read custodial USDC balance / withdraw it to an external address (custodial accounts only).
- `GET /aperture/api/messages/inbox`, `GET`/`POST /aperture/api/links/[id]/messages`, `POST .../messages/reply`, `POST .../messages/read` — buyer/seller messaging.

### Legacy Immich routes

The paid download route is `POST /aperture/api/license-download` in the mounted app. Without a `PAYMENT-SIGNATURE` header it returns HTTP 402 plus `PAYMENT-REQUIRED`. With a valid x402 payment it journals direct creator settlement, attempts to append license receipts, and returns a two-minute, one-use archive authorization bound to the shared-link key, current complete asset set, and POST method. The client submits that authorization to Aperture's server-controlled `POST /aperture/api/license-archive` proxy; shared-link credentials are never forwarded by the browser. Local demos can set `APERTURE_LICENSE_LOCAL_PROOF=1` to use the explicit `X-APERTURE-LOCAL-PROOF: 1` path; do not label that as settled.

Register an Immich owner wallet:

```bash
npm run register:owner -- \
  --owner-id <immich-owner-id> \
  --display-name "Photographer Name" \
  --wallet 0x...
```

Process a single verified demo resolve:

```bash
APERTURE_IMMICH_API_BASE_URL=http://127.0.0.1:22830/api \
APERTURE_DEMO_ACCESS_LOG_LINE='127.0.0.1 - - [24/Jun/2026:07:45:36 +0200] "POST /api/download/archive?key=<shareKey> HTTP/2.0" 200 150 "-" "aperture-demo"' \
npm run prove:demo-resolve
```

Observe authorized archive downloads in the nginx access log:

```bash
APERTURE_ACCESS_LOG=/var/log/nginx/access.log npm run watch:access-log
```

Docker sidecar run for a Linux Immich/nginx host:

```bash
docker build -f Dockerfile -t tollgate-immich-sidecar .
cat > aperture.env <<'EOF'
APERTURE_ACCESS_LOG=/var/log/nginx/access.log
APERTURE_IMMICH_API_BASE_URL=http://127.0.0.1:2283/api
APERTURE_LICENSE_FEE_ATOMIC_USDC=2500
EOF
docker volume create tollgate-aperture-data
docker run -d --name tollgate-immich-sidecar --restart unless-stopped --network host --env-file ./aperture.env -v /var/log/nginx/access.log:/var/log/nginx/access.log:ro -v tollgate-aperture-data:/app/data tollgate-immich-sidecar
```

Register an operator-approved owner mapping into the same Docker data volume:

```bash
docker run --rm --network host --env-file ./aperture.env -v tollgate-aperture-data:/app/data tollgate-immich-sidecar npm run register:owner -- --owner-id <immich-owner-id> --display-name "Photographer Name" --wallet 0x...
```

The public paid-download routes do not use a collector or perform a second FeeRouter payout. Their x402 requirement names the approved creator wallet as `payTo`; settlement fails closed when no x402 facilitator is configured.

## Environment (self-serve licensing)

```bash
APERTURE_SESSION_SECRET=<openssl rand -hex 32>       # signs session cookies + magic-link/login tokens; fails closed if unset
RESEND_API_KEY=<resend api key>                       # sends magic-link/login emails
APERTURE_MAIL_FROM="Aperture <no-reply@your-verified-domain>"
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_WALLET_SET_ID=...                              # custodial wallet minting for email/upload signups
CITATIONS_BASE_URL=https://tollgate.gudman.xyz         # dashboard's cross-app earnings aggregation
```

`ffmpeg`/`ffprobe` must be present on the host for video upload validation and thumbnail extraction (system binaries, invoked via Node's `child_process`, no npm dependency).

Never commit secrets.
