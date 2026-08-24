# Scope: FeeRouter signing key

The roadmap understates the existing boundary. Tollgate already has two
FeeRouter signer modes, but production selects neither explicitly. Because
`TOLLGATE_SIGNER` is absent from `/etc/tollgate.env`, the default is `keystore`:
the live service derives one EOA from `LEPTONWEB_FEE_ROUTER_PRIVATE_KEY` and uses
that account for every tenant. `CIRCLE_PAYER_WALLET_ID` and
`CIRCLE_PAYER_ADDRESS` are configured on the same host, but the W3S path they
enable is unused.

This is acceptable only inside the testnet operating boundary below. It is not
an argument that a hot EOA is acceptable for mainnet or material customer
funds.

## Which key signs what

`feeRouterSignerMode()` accepts `keystore` or `w3s` and defaults to `keystore`.
`createFeeRouterSigner()` applies that choice. The signer is admitted once per
complete high-level operation at five call sites:

- `routeCitationPayments()` at `citations/src/lib/fee-router.ts:603` signs USDC
  approval, `createSplit`, and each creator `pay` transaction.
- `routeEscrowReleasePayment()` at `citations/src/lib/fee-router.ts:727` signs
  approval, split creation, and the escrow-release `pay` transaction.
- `refundReaderPayment()` at `citations/src/lib/fee-router.ts:845` signs a direct
  USDC `transfer` back to the reader.
- `payCitationsWithIntent()` at `citations/src/lib/pay-gate.ts:215` signs
  approval to the configured PayGate, split creation, and `payWithIntent`.
- `askCitePay()` at `citations/src/lib/external-providers.ts:70` signs a direct
  USDC `transfer` to the external provider.

The key therefore authorizes more than creator payouts. A compromise can make
arbitrary transactions from the EOA, including direct USDC transfers; the
FeeRouter allowance is only one narrower exposure.

There is one separate coupling. When use-intent signing is enabled without
`LEPTONWEB_USE_INTENT_PRIVATE_KEY`, `createUseIntentSigner()` falls back to the
FeeRouter key. Rotation rejects that configuration because changing the
FeeRouter account would also change the signed intent identity.

## What W3S would and would not buy

In W3S mode, `createW3SFeeRouterWalletClient()` uses
`CIRCLE_PAYER_WALLET_ID` and `CIRCLE_PAYER_ADDRESS` and sends encoded contract
calls through `w3sExecuteContract()`. The application does not hold that
wallet's raw private key. Switching production to this already-built seam is
the recommended next custody step.

That switch is not a multi-signature policy and this code does not establish
that Circle's implementation is an HSM. The host still holds
`CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET`; compromise of that authorization
plane can still request signing. Funds remain concentrated in one wallet, and
Circle availability becomes part of settlement availability.

The switch also is not just one environment edit. The W3S address must be
funded, a configured PayGate must authorize that payer address, receipts will
show a different payer, and the old EOA's allowances must be revoked. Setting
`TOLLGATE_SIGNER=w3s` by itself does not move funds or revoke the old account.

## Allowance exposure and policy

At Arc block `58,595,805` on 2026-08-24, the live FeeRouter payer held
`16.854268` test USDC and granted FeeRouter `9,999.7915` USDC. A malicious or
compromised approved contract could pull only the lesser of those values, so
the immediate FeeRouter allowance exposure was `16.854268` test USDC, not
10,000. The old approval nevertheless authorized later wallet funding up to
its remaining amount without another signature.

The flat 10,000-USDC constant is replaced with a fixed per-spender ceiling of
`1,000,000` atomic USDC, or 1 USDC. It is deliberately fixed: approving the
exact payout amount leaves an allowance near zero after each payment, and
concurrent payouts then race that tiny value. Every caller now writes the same
ceiling, so concurrent approvals cannot overwrite a larger target with a
smaller one. Any one settlement operation above the ceiling fails before a
chain write. A strict `LEPTONWEB_FEE_ROUTER_ALLOWANCE_ATOMIC_USDC` override
exists for an operator-reviewed change.

One USDC covers 100 current maximum-price queries at the 10,000-atomic quote and
is slightly above the approximately `0.7907` test USDC routed over the recorded
lifetime of the project. The code also normalizes any allowance that differs
from policy, so the first settlement after deployment reduces the legacy grant
instead of leaving it in place. FeeRouter and PayGate are separate spenders; if
both are configured, each can hold a 1-USDC allowance, although their combined
ability to pull remains bounded by the shared payer balance.

This does not make concurrency unbounded. A burst whose aggregate in-flight
payouts consume 1 USDC can exhaust the allowance. That is the explicit ceiling,
not an accidental failure mode hidden behind a 10,000-USDC grant.

## Rotation

`rotateFeeRouterKeystoreSigner()` is the in-process rotation primitive. It:

1. blocks admission for the outgoing address and waits for admitted operations,
   including receipt confirmation;
2. revokes nonzero FeeRouter and configured PayGate allowances to exactly zero
   and confirms both transactions;
3. retires nonce state for the outgoing and incoming addresses so the next
   submission reloads the chain's pending nonce; and
4. activates the incoming key in that process only after every revocation
   succeeds.

`npm run prepare:fee-router-key-rotation` is deliberately narrower. It runs in a
separate process and cannot observe the server's in-memory leases. It therefore
refuses to proceed while `LEPTONWEB_INTERNAL_ORIGIN` is accepting connections.
The production procedure is: stop new ingress, wait for admitted requests to
finish, stop the service, and only then run the preparation command with the
current key in `LEPTONWEB_FEE_ROUTER_PRIVATE_KEY` and the incoming key in the
transient `LEPTONWEB_FEE_ROUTER_NEXT_PRIVATE_KEY`.

The command revokes the old allowances and reports
`allowances-revoked-activation-required`; it does not claim to have durably
rotated configuration. The operator must then replace the persistent current-key
setting with the incoming key, remove the transient next-key setting, and
restart. The incoming address must be funded separately. The command never
writes or prints either key and does not edit an environment file, move wallet
funds, deploy, or restart anything.

Already-started application operations capture one signer and remain admitted
until their receipt path finishes. New work waits while an in-process rotation
holds the outgoing address. Nonce caches are keyed by address, and explicit
retirement also makes an A-to-B-to-A rotation reload `pending` rather than reuse
A's old cache.

## Acceptable operating boundary

The single-authorizer arrangement is acceptable while all of these statements
remain true:

- settlement remains limited to test USDC on Arc testnet chain `5042002`, not
  mainnet or production customer custody;
- the payer holds no more than 25 test USDC;
- gross signer-authorized outflow remains below 5 test USDC in any rolling
  30-day period; and
- no tenant has a contractual custody, separation-of-duties, or recovery
  requirement.

The current evidence fits that boundary: the on-chain balance was `16.854268`
test USDC, and the repository's latest recorded lifetime routed volume was
approximately `0.7907` test USDC. The 25-USDC balance cap limits direct-key
compromise, while the 5-USDC rolling threshold forces review well before the
historical volume becomes operational scale. These are policy choices, not
cryptographic guarantees, and this branch does not add automatic enforcement of
the balance or rolling-volume thresholds.

The arrangement becomes unacceptable when any one condition fails: deployment
to mainnet or redeemable funds, balance above 25 USDC, 30-day outflow at or above
5 USDC, a single or aggregate settlement above the 1-USDC allowance ceiling, or
a tenant requiring independent approval. Crossing a trigger requires moving
signing behind an independently reviewed custody control before raising the
limit; increasing the environment ceiling alone is not the answer.

## What is deliberately not built

No multi-signature wallet is built. Safe or another multisig factory deployment
on Arc testnet `5042002` is unconfirmed, and provisioning and operating one is
operator infrastructure rather than a FeeRouter code change.

No HSM integration is built, and W3S is not relabelled as one without evidence.
No per-tenant signer, FeeRouter contract change, ABI change, automatic fund
transfer, environment-file rewrite, deployment, or signer-mode switch is part
of this branch. The branch provides a bounded allowance, an in-process
drain-safe rotation primitive, an offline preparation command with an explicit
activation handoff, and an auditable trigger for when that answer is no longer
enough.
