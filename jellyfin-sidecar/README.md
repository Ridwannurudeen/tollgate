# Tollgate Jellyfin Sidecar

Status: DOCKER-DRY-RUN-VALIDATED

Readiness: READY-needs-real-Jellyfin-webhook-plugin-config

This package is a Jellyfin Webhook sidecar for Tollgate per-minute VOD accounting.
It consumes PlaybackStart and PlaybackStop webhook events, maps Jellyfin item IDs
to creator wallets from `data/registry.json`, computes watched minutes, writes a
hash-chained receipt ledger, and routes settlement through a FeeRouter adapter
that is dry-run only in Wave 3.1.

## Verified Jellyfin Webhook Shape

Verified sources before implementation:

- Jellyfin official docs: the Webhook plugin is configured from Dashboard >
  Plugins and can enable notification types plus destinations.
  Source: https://jellyfin.org/docs/general/server/notifications/
- Official plugin README: the Webhook plugin exposes variables including
  `NotificationType`, `ItemId`, `ItemType`, `RunTimeTicks`,
  `PlaybackPositionTicks`, `PlaybackPosition`, `DeviceId`, `DeviceName`,
  `ClientName`, `UserId`, and `PlayedToCompletion` only for PlaybackStop.
  Source: https://github.com/jellyfin/jellyfin-plugin-webhook
- Official plugin source: `PlaybackStartNotifier` builds a data object with
  `NotificationType.PlaybackStart`, base item data, playback progress data, and
  session/user fields before sending.
  Source: https://raw.githubusercontent.com/jellyfin/jellyfin-plugin-webhook/master/Jellyfin.Plugin.Webhook/Notifiers/PlaybackStartNotifier.cs
- Official plugin source: `PlaybackStopNotifier` uses the same data object and
  also adds `PlayedToCompletion`.
  Source: https://raw.githubusercontent.com/jellyfin/jellyfin-plugin-webhook/master/Jellyfin.Plugin.Webhook/Notifiers/PlaybackStopNotifier.cs
- Official plugin source: `BaseOption.GetMessageBody` serializes the complete
  data dictionary as JSON when `SendAllProperties` is enabled, and
  `GenericClient` POSTs that body to the configured URL.
  Sources:
  https://raw.githubusercontent.com/jellyfin/jellyfin-plugin-webhook/master/Jellyfin.Plugin.Webhook/Destinations/BaseOption.cs
  https://raw.githubusercontent.com/jellyfin/jellyfin-plugin-webhook/master/Jellyfin.Plugin.Webhook/Destinations/Generic/GenericClient.cs

Assumptions recorded in fixtures:

- The generic destination is configured with `Send All Properties` enabled.
- The emitted body is flat JSON with Jellyfin plugin keys, matching the official
  source paths above.
- Jellyfin does not document a stable webhook event ID, so this sidecar derives
  idempotency from item, user, session/device, stop timestamp, and stop position.
- Wallet ownership is operator supplied in the registry because Jellyfin item
  metadata does not contain a creator wallet.

## Jellyfin Setup

1. Install the Jellyfin Webhook plugin and restart Jellyfin.
2. Add a Generic destination with URL:

   ```text
   http://<sidecar-host>:4317/webhooks/jellyfin
   ```

3. Enable notification types: Playback Start and Playback Stop.
4. Enable the item classes you want to monetize, such as Movies, Episodes, or
   Videos.
5. Check `Send All Properties (ignores template)`.
6. Use `Content-Type: application/json` if your plugin version exposes headers.
   The sidecar parses JSON even if the plugin sends the default text content type.

## Registry

Copy `data/registry.example.json` to `data/registry.json` and replace the
Jellyfin item ID and wallet:

```json
{
  "videos": [
    {
      "itemId": "video-demo-001",
      "title": "Demo Independent Film",
      "displayName": "Demo Creator",
      "wallet": "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      "priceAtomicUsdcPerMinute": 2500,
      "approvalStatus": "operator-approved"
    }
  ]
}
```

`approvalStatus: "pending"` is accepted in the file but will not settle.

## Local Run

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

Routes:

- `POST /webhooks/jellyfin` consumes PlaybackStart and PlaybackStop payloads.
- `GET /health` returns ledger verification, registry count, and dry-run status.
- `GET /proof` returns the public proof pack and full hash-chained receipt ledger.

Environment:

- `JELLYFIN_SIDECAR_PORT` default `4317`
- `JELLYFIN_REGISTRY_PATH` default `data/registry.json`
- `JELLYFIN_LEDGER_PATH` default `data/ledger.json`
- `JELLYFIN_SESSIONS_PATH` default `data/sessions.json`
- `JELLYFIN_USDC_ATOMIC_PER_MINUTE` default `2500`
- `JELLYFIN_FEE_ROUTER_MODE` default `dry-run`

Wave 3.1 has no live-spend path. Any mode other than `dry-run` fails at startup.

## Docker Demo Kit

```bash
cp data/registry.example.json data/registry.json
docker compose up --build
```

The compose file starts a Jellyfin container and the sidecar. You still need to
finish Jellyfin first-run setup, install/configure the Webhook plugin, import a
media item, and set that media item's Jellyfin `ItemId` in `data/registry.json`.

## Docker Validation

Validated on 2026-07-03 in WSL Ubuntu 24.04 using Docker Engine 29.1.3 and
Docker Compose 2.40.3.

Commands:

```bash
cp data/registry.example.json data/registry.json
docker compose up -d --build
curl -I http://127.0.0.1:8096/
curl http://127.0.0.1:4317/health
curl -X POST -H "Content-Type: application/json" \
  --data-binary @fixtures/jellyfin-playback-start.json \
  http://127.0.0.1:4317/webhooks/jellyfin
curl -X POST -H "Content-Type: application/json" \
  --data-binary @fixtures/jellyfin-playback-stop.json \
  http://127.0.0.1:4317/webhooks/jellyfin
curl http://127.0.0.1:4317/proof
```

Observed:

```text
Jellyfin: HTTP/1.1 302 Found -> web/
Sidecar health: ok=true, registry.videos=1
PlaybackStop: created=true, watchedMinutes=2, amountAtomicUsdc=5000
Proof: verification.ok=true, receiptCount=1, totalAtomicUsdc=5000
Duplicate PlaybackStop: created=false
```

This validates the Docker wiring, sidecar HTTP surface, fixture webhook handling,
hash-chained ledger, and dry-run FeeRouter adapter. It does not prove Jellyfin's
Webhook plugin UI because the local container still needs first-run setup and
plugin configuration. Live settlement remains disabled by design.

## Receipt Semantics

- A PlaybackStart stores the active session keyed by item, user, and
  session/device.
- A PlaybackStop computes watched seconds from playback-position tick delta when
  available, otherwise elapsed timestamps, otherwise full runtime only when
  `PlayedToCompletion` is true.
- Billable minutes are `ceil(watchedSeconds / 60)`.
- A duplicate PlaybackStop returns the existing receipt and does not call the
  FeeRouter adapter again.
- Each receipt stores `previousHash` and `receiptHash`; `/proof` and `/health`
  verify the chain before reporting `ok: true`.
