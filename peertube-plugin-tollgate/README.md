# peertube-plugin-tollgate

**Let your creators get paid when their videos are downloaded — automatically, per download, with a public receipt.**

PeerTube instance admins have asked for a way to pay creators for years, and there is still no in-tree feature (issue [#1586](https://github.com/Chocobozzz/PeerTube/issues/1586) ran 7 years). Existing options either take a large cut on small amounts or route money off-platform with no proof it reached the creator.

This plugin closes that gap. When a viewer downloads a video, the plugin routes a small payment straight to that video's creator and writes a tamper-evident receipt you can hand to the creator or show publicly. No per-download platform fee, no custody in the middle, and the receipt is verifiable by anyone.

## What it does

- Gates video downloads behind a small payment (configurable price, off by default until you set a creator wallet).
- Routes the payment to the creator and records a **hash-chained receipt** (each receipt links to the previous one, so the ledger can't be silently edited).
- Adds a small "Support the creator" panel on the watch page.
- Exposes a `/proof` endpoint that lists every receipt and confirms the chain is intact.

Payments settle in USDC on Arc, so the minimum viable payment is a fraction of a cent instead of the ~$2 floor card rails impose — which is what makes per-download payments possible at all. Viewers and creators never need to think about any of that; they see a price and a receipt.

## Install (self-hosted PeerTube)

The plugin is published to npm under the `peertube-plugin-` convention, so it appears in every instance's **Administration → Plugins/Themes → Search** within ~a day of publish, and installs with one click. No approval process.

For local development against your own instance:

```bash
peertube-cli auth add -u 'https://your.peertube' -U 'root' --password '...'
peertube-cli plugins install --path /absolute/path/to/peertube-plugin-tollgate
```

## Configure (admin settings)

- **Default creator wallet** / **Creator wallet mapping** — where payments go. Mapping is one `videoUuid=0xWallet` per line; the default is used when a video has no explicit entry.
- **Price per unlock** — atomic USDC (6 decimals). `2500` = 0.0025 USDC.
- **Gate downloads** — whether downloads are blocked until paid.
- **Operator private key** — the wallet that funds payouts. Leave empty to run without on-chain payouts (nothing settles).
- **Arc RPC / chain id / FeeRouter / USDC / explorer** — default to Arc testnet; override to point at another deployment.

## Verify a payment

Open `/plugins/tollgate/router/proof` on your instance for the receipt list and chain status, then follow any `transaction` to the block explorer.

## Honest notes

- Settlement is **per-download** (and per-view is recorded for analytics). PeerTube exposes a counted-view hook, not per-second watch-time, so this plugin does **not** meter watch-time.
- The MVP payout is **operator-funded**: your operator wallet routes the payment to the creator. A viewer-signed flow is a planned enhancement.
- This plugin uses PeerTube's plugin router with `req.rawBody` (added by PeerTube [PR #6300](https://github.com/Chocobozzz/PeerTube/pull/6300), which exposes the raw request body for signature verification — it is a primitive, not a built-in payments feature).
- Real-world reach depends on admins choosing to install it; the demo runs against a self-hosted instance.

## License

AGPL-3.0.
