# Aperture

Aperture is a sidecar for Immich that pays photographers when shared photos are downloaded.

It watches Immich download requests, resolves the shared-link key to asset owners, maps each owner to an Arc wallet, and writes hash-chained payout receipts. When configured with this project's own funded payer key, it routes USDC through Forum `FeeRouterV1` on Arc testnet.

## Verified Immich v2.7.5 Flow

The live Immich server emits this sequence for a public shared-link download:

- Page view: `GET /api/shared-links/me?key=<shareKey>`
- Render preview: `GET /api/assets/<assetId>/thumbnail?key=<shareKey>&...`
- Download click: `POST /api/download/info?key=<shareKey>`
- Billable download: `POST /api/download/archive?key=<shareKey>`

The nginx access log preserves the archive request path and query string. Aperture treats `POST /api/download/archive?key=<shareKey>` as the billable resolve event, then resolves the key through Immich's shared-link API.

## Local Development

```bash
npm install
npm run typecheck
npm test -- --run
npm run build
```

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

Watch nginx access logs on the Immich box:

```bash
APERTURE_ACCESS_LOG=/var/log/nginx/access.log npm run watch:access-log
```

FeeRouter settlement is disabled by default. To settle on Arc, set:

```bash
APERTURE_FEE_ROUTER_ENABLED=1
APERTURE_FEE_ROUTER_PRIVATE_KEY=<project-funded-payer-key>
```

Optional EXIF enrichment reads the original file path Immich returns for an
asset and stores Artist/Copyright on the receipt:

```bash
APERTURE_EXIF_ENABLED=1
APERTURE_EXIFTOOL_PATH=exiftool
```

Never commit secrets.
