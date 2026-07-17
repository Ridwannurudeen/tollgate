# Verified Immich Flow

Verified against the live Immich v2.7.5 server on June 24, 2026.

## Public Shared Link

The seeded demo shared link loaded successfully through an SSH tunnel to Immich:

- `GET /share/<key>` returned `200 text/html`.
- Browser page title: `Public Share`.
- The visible page had a photo tile and a `Download` button.

## Browser Network Sequence

Page load:

- `GET /api/shared-links/me?key=<shareKey>` returned `200`.
- `GET /api/server/config` returned `200`.
- `GET /api/server/features` returned `200`.
- `GET /api/server/media-types` returned `200`.
- `GET /api/assets/<assetId>/thumbnail?key=<shareKey>&size=thumbnail&...` returned `200`.

Download button:

- `POST /api/download/info?key=<shareKey>` returned `201`.
- Request body: `{"assetIds":["<assetId>"]}`.
- `POST /api/download/archive?key=<shareKey>` returned `200`.
- Request body: `{"assetIds":["<assetId>"],"edited":true}`.
- Browser downloaded `immich-shared-20260624_064438.zip`.

## Authorization and Observation

Aperture's payment gate resolves the complete current shared link, settles the
required amount directly to its approved payout wallet, journals the payment,
attempts the receipts, and returns a short-lived one-use authorization. The
supported client submits that authorization to Aperture's server-controlled
archive proxy:

```text
POST /aperture/api/license-archive?key=<shareKey>&tollgateAuthorization=<token>
```

The authorization binds the shared-link identity, complete asset set, and POST
method. The proxy re-resolves that scope, atomically reserves the token, and
sends the canonical archive body to the trusted Immich origin itself. The two
nginx templates also keep direct Immich shared-link archive requests gated and
strip client-supplied share credentials before proxying.

The watcher resolves the `shareKey` through:

```text
GET /api/shared-links/me?key=<shareKey>
```

That response includes the assets and each asset `ownerId`. The watcher only
correlates a successful access-log event with the existing gate receipts; it
does not settle funds or write receipts.

## Deployment Boundary

`/etc/nginx/sites-available/immich.gudman.xyz.conf` exists, but the site was not enabled in `/etc/nginx/sites-enabled` during verification. Requests with host `immich.gudman.xyz` were handled by the default `agentbond` server block and returned `502`.

Public HTTPS still needs DNS plus nginx enable/reload before judges can access Immich directly.

## 2026-07-08 Public Surface Recheck

`immich.gudman.xyz` no longer resolves in public DNS, so enabling the existing
nginx vhost alone would not make the standalone Immich hostname reachable. The
current public surface is Tollgate-hosted instead:

- `https://tollgate.gudman.xyz/immich` explains the Immich sidecar status.
- `https://tollgate.gudman.xyz/immich/api/server/config` reaches the live local
  Immich API through nginx.
- `https://tollgate.gudman.xyz/aperture/api/proof` remains the authoritative
  Aperture/Immich proof pack for the shared-link download ledger.
