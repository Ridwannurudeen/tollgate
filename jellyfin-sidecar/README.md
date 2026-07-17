# Tollgate Jellyfin Sidecar

Status: DRY-RUN-ONLY

Readiness: LIVE-BLOCKED-needs-durable-prepayment-journal

This package is a Jellyfin Webhook sidecar for Tollgate per-minute VOD accounting.
It consumes authenticated PlaybackStart and PlaybackStop webhook events, maps
Jellyfin item IDs to creator wallets from `data/registry.json`, computes watched
minutes, writes a hash-chained receipt ledger, and routes settlement through a FeeRouter adapter
that runs in dry-run mode. Configuration rejects live FeeRouter settlement until
a durable pre-payment journal and restart-safe reconciliation path exist.

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

1. Ask the Tollgate operator to register a media item ID, creator display name,
   payout wallet, and optional per-minute price.
2. Copy the one-time Tollgate API key returned by the operator.
3. Install the Jellyfin Webhook plugin and restart Jellyfin.
4. Add a Generic destination with URL:

   ```text
   https://tollgate.gudman.xyz/jellyfin/api/webhooks/jellyfin
   ```

5. Add header `X-Tollgate-Key` with the one-time key as its value. The sidecar
   also accepts `Authorization: Bearer <key>`.
6. Enable notification types: Playback Start and Playback Stop.
7. Enable the item classes you want to monetize, such as Movies, Episodes, or
   Videos.
8. Check `Send All Properties (ignores template)`.
9. Use `Content-Type: application/json` if your plugin version exposes headers.
   The sidecar parses JSON even if the plugin sends the default text content type.

## Registry

The hosted registration route writes both `data/operators.json` and
`data/registry.json`. For local/manual runs, copy `data/registry.example.json`
to `data/registry.json` and replace the Jellyfin item ID and wallet:

```json
{
  "videos": [
    {
      "itemId": "video-demo-001",
      "title": "Fixture PlaybackStop Replay",
      "displayName": "Fixture Creator",
      "wallet": "0x12F25B721Cc21c38495e33A4c8524dd0B647ba03",
      "priceAtomicUsdcPerMinute": 2500,
      "approvalStatus": "operator-approved"
    }
  ]
}
```

`approvalStatus: "pending"` is accepted in the file but will not settle. Once
an item ID is registered through the API, its operator, wallet, and price
binding cannot be replaced by another registration.

## Local Run

```bash
npm install
npm test
npm run typecheck
npm run build
npm run dev
```

Routes:

- `POST /operators/register` requires `X-Tollgate-Registration-Secret`, issues
  a one-time API key, stores only its hash, and writes an immutable
  item-to-wallet mapping.
- `POST /webhooks/jellyfin` consumes PlaybackStart and PlaybackStop payloads
  only when `X-Tollgate-Key` or `Authorization: Bearer <key>` authenticates a
  registered operator for the event item ID.
- `GET /health` returns ledger verification, registry count, and dry-run status.
- `GET /proof` returns the public proof pack and a hash-bound receipt projection
  without raw Jellyfin viewer or session identifiers.

Environment:

- `JELLYFIN_SIDECAR_PORT` default `4317`
- `JELLYFIN_REGISTRY_PATH` default `data/registry.json`
- `JELLYFIN_OPERATORS_PATH` default `data/operators.json`
- `JELLYFIN_LEDGER_PATH` default `data/ledger.json`
- `JELLYFIN_SESSIONS_PATH` default `data/sessions.json`
- `JELLYFIN_PUBLIC_WEBHOOK_URL` default
  `https://tollgate.gudman.xyz/jellyfin/api/webhooks/jellyfin`
- `JELLYFIN_REGISTRATION_SECRET` server-held capability required by
  `POST /operators/register`
- `JELLYFIN_SERVER_URL` reserved for eventual live mode; base URL of the
  authoritative Jellyfin server
- `JELLYFIN_API_KEY` reserved for eventual live mode; server-held Jellyfin API
  key
- `JELLYFIN_USDC_ATOMIC_PER_MINUTE` default `2500`
- `JELLYFIN_MAX_ATOMIC_USDC_PER_EVENT` default `1000000`
- `JELLYFIN_MAX_DAILY_ATOMIC_USDC` default `10000000`
- `JELLYFIN_FEE_ROUTER_MODE` default `dry-run`; `live` and `forum-routed` are
  rejected at configuration load
- `JELLYFIN_FEE_ROUTER_PRIVATE_KEY` is the only accepted signer variable and is
  reserved for eventual live mode; shared Leptonweb or Aperture keys are ignored
- `JELLYFIN_ARC_RPC_URL` default `https://rpc.testnet.arc.network`
- `JELLYFIN_ARC_CHAIN_ID` default `5042002`
- `JELLYFIN_USDC_ADDRESS` default `0x3600000000000000000000000000000000000000`
- `JELLYFIN_FEE_ROUTER_ADDRESS` default `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59`
- `JELLYFIN_FEE_ROUTER_SPLIT_REGISTRY_PATH` default `data/fee-router-splits.json`

Live mode currently fails closed even when the dedicated signer and
authoritative Jellyfin verification credentials are present. Before this gate
can be removed, the sidecar needs to persist a pre-payment intent before
FeeRouter submission and reconcile mined, reverted, replaced, and ambiguous
transactions after process restarts. The live adapter and server-verification
logic remain unit-tested, but they are not reachable through configuration.
Dry-run remains available for local development and Docker demos.

Historical pre-hardening fixture replay recorded on 2026-07-08:

- Public proof: `https://tollgate.gudman.xyz/jellyfin/api/proof`
- Public page: `https://tollgate.gudman.xyz/jellyfin`
- FeeRouter pay tx from a `fixtures/jellyfin-playback-*.json` replay:
  `0xd44b494f3a603f3590926d24e52773b288bc95e0c4558b36fbcc7935cdb6a73e`
- Proof status: `LIVE-FEEROUTER-FIXTURE-REPLAY`

That receipt proves the older sidecar could call FeeRouter, but it is not proof
of a real Jellyfin server emitting a viewer event. Normal server startup through
`loadConfig` does not enable live settlement. The proof pack retains the
historical `forum-routed` receipt while reporting `liveSpendEnabled: false` when
the server runs in dry-run mode.

## Docker Demo Kit

```bash
docker compose up --build
```

The compose file starts a Jellyfin container and the sidecar, hard-pinned to
dry-run. It exposes only the dedicated `JELLYFIN_FEE_ROUTER_PRIVATE_KEY`
namespace and does not import another Tollgate service's signer. You still need
to finish Jellyfin first-run setup, install/configure the Webhook plugin, import
a media item, and register that media item's Jellyfin `ItemId` through
`POST /operators/register` or by editing local data files for a fixture replay.

## Docker Validation

Validated on 2026-07-03 in WSL Ubuntu 24.04 using Docker Engine 29.1.3 and
Docker Compose 2.40.3.

Commands:

```bash
docker compose up -d --build
curl -I http://127.0.0.1:8096/
curl http://127.0.0.1:4317/health
curl -X POST -H "Content-Type: application/json" \
  -H "X-Tollgate-Registration-Secret: local-demo-registration-capability" \
  --data '{"operatorName":"Local Jellyfin","itemId":"video-demo-001","displayName":"Fixture Creator","wallet":"0x12F25B721Cc21c38495e33A4c8524dd0B647ba03","priceAtomicUsdcPerMinute":2500}' \
  http://127.0.0.1:4317/operators/register
curl -X POST -H "Content-Type: application/json" \
  -H "X-Tollgate-Key: <api-key-from-registration>" \
  --data-binary @fixtures/jellyfin-playback-start.json \
  http://127.0.0.1:4317/webhooks/jellyfin
curl -X POST -H "Content-Type: application/json" \
  -H "X-Tollgate-Key: <api-key-from-registration>" \
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
plugin configuration. Historical `forum-routed` receipts remain visible through
`https://tollgate.gudman.xyz/jellyfin/api/proof`; they do not mean the current
server can initiate live spend.

## Receipt Semantics

- A dry-run PlaybackStart stores the active session keyed by item, user, and
  session/device. A live PlaybackStart is stored only after the Jellyfin server
  confirms that active playback.
- A PlaybackStop computes watched seconds from playback-position tick delta when
  available. The retained live-processing logic additionally caps that value by
  trusted elapsed time and the server-reported runtime; stop-only events never
  settle in those unit tests, but configuration currently blocks live execution.
- Billable minutes are `ceil(watchedSeconds / 60)`.
- Duplicate and concurrent PlaybackStop events for the same derived event ID
  return one receipt and call the FeeRouter adapter at most once.
- Each receipt stores `previousHash` and `receiptHash`; `/proof` and `/health`
  verify the stored chain before reporting `ok: true`. The public proof keeps
  those hashes but omits raw `userId` and `sessionId` fields.
