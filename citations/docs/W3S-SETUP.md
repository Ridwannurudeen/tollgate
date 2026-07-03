# Circle W3S setup — the keyless agent payer

Tollgate's autonomous payer agent signs its x402 citation payments through Circle
W3S (Developer-Controlled Wallets) — no private key on our box. This is a one-time
provisioning the build can't do for you (it needs a Circle account + Console
registration + a faucet drip).

## What you provision (one time)

1. **Circle Developer account + testnet API key.** Console -> create a Sandbox/Testnet
   API key. This is `CIRCLE_API_KEY`.
2. **Entity secret.** Generate a 32-byte hex secret, then **register it** in the Console
   (Wallets -> Developer-Controlled -> Configurator). Registration is mandatory — an
   unregistered secret makes every signing call fail opaquely. This is `CIRCLE_ENTITY_SECRET`.
3. Put both in `.env.local` (gitignored) at the repo root:
   ```
   CIRCLE_API_KEY=...
   CIRCLE_ENTITY_SECRET=...
   ```

## What the build does (already wired)

4. `npm run create:circle-wallets` — creates the wallet set and the payer wallet; writes
   `CIRCLE_WALLET_SET_ID` and `CIRCLE_PAYER_WALLET_ID/_ADDRESS` back into `.env.local`.
   Idempotent.
5. **Fund the payer.** Send Arc-Testnet USDC to the printed `CIRCLE_PAYER_ADDRESS` at
   https://faucet.circle.com (~5 USDC covers a lot of sub-cent queries). The exact x402
   flow is gasless, so the payer needs USDC but no native gas.

## Verify (the critical gate)

With a local dev server running (`npm run dev`):
```
npm run prove:w3s-source circle-gateway-nano
npm run prove:w3s-paid-query
```
Success = a real `x402-settled`/`x402-verified` receipt whose `payer` equals
`CIRCLE_PAYER_ADDRESS`, `signedBy: "circle-w3s"`. This proves the keyless signing
seam end-to-end.

## Server payout signer switch

The FeeRouter payout path now has the same signer boundary as the x402 reader
path:

```
TOLLGATE_SIGNER=keystore
```

uses the existing local server key from `LEPTONWEB_FEE_ROUTER_PRIVATE_KEY`.

```
TOLLGATE_SIGNER=w3s
```

uses `CIRCLE_PAYER_WALLET_ID` + `CIRCLE_PAYER_ADDRESS` and submits FeeRouter
`approve`, `createSplit`, and `pay` calls through Circle W3S contract execution.
This is READY-needs-CIRCLE_API_KEY-and-CIRCLE_ENTITY_SECRET: the code path is
implemented and typechecked locally, but it should only be live-tested after the
Circle sandbox entity secret is registered and the W3S wallet is funded.

## Env var reference

| Var | Set by | Purpose |
| --- | --- | --- |
| `CIRCLE_API_KEY` | you | bearer auth to Circle W3S |
| `CIRCLE_ENTITY_SECRET` | you (register in Console) | RSA-encrypted per request; authorizes signing |
| `CIRCLE_WALLET_SET_ID` | `create:circle-wallets` | wallet set holding the payer wallet |
| `CIRCLE_PAYER_WALLET_ID` / `_ADDRESS` | `create:circle-wallets` | the keyless spending agent (fund the address) |
| `TOLLGATE_SIGNER=keystore\|w3s` | operator | select local FeeRouter signer or W3S contract execution |
| `LEPTONWEB_PAYER_MODE=local` | optional break-glass | force the local DPAPI keystore payer for x402 proof scripts |

## Honest scope

"No private keys" applies to the **autonomous spending agent**. The protocol's
facilitator/settler (which broadcasts the EIP-3009 transfer and pays gas) still uses a
server key — true of every x402 deployment. The claim is "the agent that spends holds
no key," not "no keys anywhere." The W3S integration follows Circle's published
Developer-Controlled Wallets REST pattern.

## Security

`.env.local` is gitignored. Before any public push, rotate `CIRCLE_API_KEY` and
`CIRCLE_ENTITY_SECRET`, and confirm neither lands in a committed file.
