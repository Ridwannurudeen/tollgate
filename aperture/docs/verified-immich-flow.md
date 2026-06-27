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

## Watcher Trigger

Aperture uses only the nginx access-log-visible trigger:

```text
POST /api/download/archive?key=<shareKey>
```

The POST body is not present in normal nginx access logs, so the watcher resolves the `shareKey` through:

```text
GET /api/shared-links/me?key=<shareKey>
```

That response includes the assets and each asset `ownerId`.

## Deployment Boundary

`/etc/nginx/sites-available/immich.gudman.xyz.conf` exists, but the site was not enabled in `/etc/nginx/sites-enabled` during verification. Requests with host `immich.gudman.xyz` were handled by the default `agentbond` server block and returned `502`.

Public HTTPS still needs DNS plus nginx enable/reload before judges can access Immich directly.
