# Local demo: pay a PeerTube creator per download

This runs PeerTube locally and installs `peertube-plugin-tollgate` from the
checked-out source so you can show the full flow end to end:

**upload a video → try to download → download is gated → pay the creator →
USDC settles to their wallet on Arc → download unlocks, receipt is verifiable.**

> The Docker setup mirrors PeerTube's official production compose but was not
> booted in the plugin's authoring environment. Treat the exact env/commands as
> a starting point and adjust to your PeerTube image version if boot fails.

## 1. Start PeerTube

```bash
cd peertube-plugin-tollgate/demo
docker compose up -d
# wait ~1 minute for first boot, then get the generated root password:
docker compose logs peertube | grep -A1 'User password'
# (or reset it): docker compose exec -u peertube peertube npm run reset-password -- -u root
```

Open `http://localhost:9000` and log in as `root`.

## 2. Install the plugin from the mounted source

```bash
docker compose exec -u peertube peertube \
  npm run plugin:install -- --plugin-path /plugins-local/peertube-plugin-tollgate
```

(Or install it from the admin UI once published: **Administration →
Plugins/Themes → Search → "tollgate"**.)

## 3. Configure it (Administration → Plugins → tollgate → Settings)

- **Operator private key** — a funded Arc wallet that pays creators (this is what
  settles on-chain). Without it the plugin runs verify-only (no payout).
- **Default creator wallet** — where payments go, e.g. a creator's Arc address.
- **Price per unlock** — atomic USDC (6 decimals); `2500` = 0.0025 USDC.
- **Gate downloads** — on.
- Leave FeeRouter / USDC / RPC / chain id at their Arc-testnet defaults.

## 4. Demo the flow

1. Upload a video as a creator (or map a specific video: set
   `creator-wallets` to `<videoUuid>=0xWallet`).
2. As a viewer, try to download it → the plugin blocks it with
   "Payment required…".
3. Click **Pay the creator** on the watch page (or `POST` to
   `/plugins/tollgate/router/video/<uuid>/pay`).
4. The operator wallet routes USDC to the creator through FeeRouter on Arc.
5. Download now succeeds. Open
   `http://localhost:9000/plugins/tollgate/router/proof` for the receipt list,
   and follow the `transaction` to `https://testnet.arcscan.app`.

## Proving the settlement without PeerTube

If you just want to prove the on-chain payout path (no PeerTube needed), the
repo's `scripts/prove-peertube-payout.mjs` drives the plugin's own
`routeCreatorPayment` against Arc and prints the FeeRouter txs + receipt.

## Tear down

```bash
docker compose down          # keep data
docker compose down -v       # wipe volumes
```
