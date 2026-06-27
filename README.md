# Tollgate

**Creators don't get paid for how their work is actually used.** A writer earns nothing when an AI cites their article; a photographer earns nothing when someone downloads their photo. Per-use payments were always too small to clear — so the world defaulted to subscriptions, or nothing. Nanopayments on Arc remove that floor.

Tollgate is one **settlement core** with **two live integrations** into two real communities. This repo holds both as independent apps:

| App | What it does | Live |
| --- | --- | --- |
| [`citations/`](./citations) | An autonomous answer agent buys the sources it cites and pays each creator per citation. | `https://tollgate.gudman.xyz` |
| [`aperture/`](./aperture) | A permissionless sidecar on self-hosted **Immich** pays photographers per shared-photo download, with no upstream changes. | `https://tollgate.gudman.xyz/aperture` |

**Unified overview + live proof:** `https://tollgate.gudman.xyz/core`

## The shared core
- **x402** for the per-request payment; **Circle Gateway** for gas-free **batched on-chain settlement**; **USDC on Arc**; a shared on-chain **FeeRouter** (Forum) that splits to every creator.
- Creator payouts settle on-chain as `forum-routed` receipts in an append-only, hash-linked ledger.
- Arc testnet: chainId `5042002` · RPC `https://rpc.testnet.arc.network` · USDC `0x3600000000000000000000000000000000000000` · FeeRouter `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59` · explorer `https://testnet.arcscan.app`

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
