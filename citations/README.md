# Tollgate Citations

Tollgate Citations is the answer-agent integration of the Tollgate settlement core. The agent buys the sources it cites, pays each creator per citation, and writes attribution receipts on Arc testnet.

Live app: `https://tollgate.gudman.xyz`

Unified overview: `https://tollgate.gudman.xyz/core`

## How the core works

- x402 for reader/source payments.
- Circle Gateway support for batched autonomous-agent settlement.
- USDC on Arc testnet.
- Forum FeeRouter routes creator payouts and records `forum-routed` receipt evidence.
- The reader endpoint (`/api/paid-query`) is multi-accept: browser wallets pay the `exact` scheme, autonomous agents can pay through Gateway batching, and the server settles against whichever requirement the payer signed.

## Verify it is real

- Settlement status: `https://tollgate.gudman.xyz/api/settlement/status`
- Proof pages: `/proof`, `/core`, `/answers/<queryId>`, `/creators/<wallet>`, `/sources/<sourceId>`, `/receipts/<hash>`
- Arc explorer: `https://testnet.arcscan.app`

## API surface

- `GET /api/sources`: list priced sources.
- `POST /api/sources`: self-register a priced source.
- `POST /api/query`: run a local-proof answer and receipt path.
- `POST /api/paid-query`: require reader x402 payment, then pay cited creators.
- `GET /api/ledger`: public ledger JSON.
- `GET /api/receipts/<hash>`: single receipt evidence.
- `GET /api/settlement/status`: runtime settlement status.

## Run and verify locally

```bash
npm install
npm run dev
npm test
npm run typecheck
npm run build
npm run verify:ledger
```

## Arc testnet

- chainId: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- USDC: `0x3600000000000000000000000000000000000000`
- FeeRouter: `0xeff9bc359e8f2a5eabce55af3f1bb24f98eabf59`

## Repo layout

- This monorepo: settlement core + Citations integration in `citations/`.
- Aperture photo licensing: Immich sidecar in `aperture/`.

Built for the Lepton Agents Hackathon. AI usage: see `AI_USAGE.md`.
