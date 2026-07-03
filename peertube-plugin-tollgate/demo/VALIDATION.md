# PeerTube Demo Validation

Status: DONE-local-Docker-validated

Validated on 2026-07-03 in WSL Ubuntu 24.04 using Docker Engine, not Docker Desktop.

## Environment

```text
Docker version 29.1.3, build 29.1.3-0ubuntu3~24.04.2
Docker Compose version 2.40.3+ds1-0ubuntu1~24.04.1
hello-world container: OK
```

The demo compose originally failed on the Windows/OneDrive bind-mounted Postgres
data directory:

```text
initdb: error: could not change permissions of directory "/var/lib/postgresql/data": Operation not permitted
```

The compose file now uses Docker named volumes for Postgres, Redis, and PeerTube
mutable data. The plugin source is still mounted read-only from the repo.

## Stack Boot

```bash
cd peertube-plugin-tollgate/demo
docker compose up -d
docker compose ps
```

Result:

```text
tollgate-peertube-demo-peertube-1   Up   0.0.0.0:9000->9000/tcp
tollgate-peertube-demo-postgres-1   Up   5432/tcp
tollgate-peertube-demo-redis-1      Up   6379/tcp
```

PeerTube served HTTP:

```text
HTTP/1.1 200 OK
x-powered-by: PeerTube
```

## Plugin Install

Install command inside the PeerTube container:

```bash
node /app/dist/scripts/plugin/install.js --plugin-path /plugins-local/peertube-plugin-tollgate
```

Result:

```text
Successful installation of plugin /plugins-local/peertube-plugin-tollgate.
Registering plugin or theme peertube-plugin-tollgate.
```

Reality fix from the first install attempt: PeerTube validates package metadata
with required `homepage` and `bugs` URL fields. The plugin package now includes
both.

## Router Endpoints

```bash
curl http://127.0.0.1:9000/plugins/tollgate/router/config
curl http://127.0.0.1:9000/plugins/tollgate/router/video/demo-video/status
curl http://127.0.0.1:9000/plugins/tollgate/router/proof
curl -X POST http://127.0.0.1:9000/plugins/tollgate/router/video/demo-video/pay
```

Observed:

```json
{"chainId":5042002,"priceAtomicUsdc":2500,"gateDownloads":true,"payoutsEnabled":false}
{"videoId":"demo-video","creatorWallet":null,"paid":false,"receipt":null}
{"receiptCount":0,"totalRoutedAtomicUsdc":0,"chainValid":true,"receipts":[]}
{"error":"no creator wallet configured for this video"}
```

No private operator key was configured, so no on-chain payout was attempted.

## Settings And Client Script

Public plugin settings render through PeerTube's plugin API:

```bash
curl http://127.0.0.1:9000/api/v1/plugins/peertube-plugin-tollgate/public-settings
```

Observed public defaults include:

```json
{"price-atomic-usdc":"2500","gate-downloads":true,"fee-router-address":"0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59"}
```

Client script path:

```text
GET /plugins/tollgate/0.1.0/client-scripts/client/tollgate-watch.js -> HTTP/1.1 200 OK
```

The served script starts with the expected `register({ registerHook, peertubeHelpers })`.

## Hook Shape

Verified against the running PeerTube image:

```text
/app/dist/core/controllers/download.js calls:
Hooks.wrapFun(isVideoDownloadAllowed, { req, res, video, videoFile }, "filter:api.download.video.allowed.result")
Hooks.wrapFun(isVideoDownloadAllowed, { req, res, video, streamingPlaylist, videoFile }, "filter:api.download.video.allowed.result")
checkAllowResult expects { allowed: true } or rejects with result.errorMessage.

/app/dist/core/controllers/api/videos/view.js calls:
Hooks.runAction("action:api.video.viewed", { video, ip, req, res })
```

The plugin handler reads `params.video` and returns `{ allowed: false, errorMessage }`
when an unpaid download is gated, matching the actual PeerTube controller path.
