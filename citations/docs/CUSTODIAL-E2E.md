# Custodial Creator E2E

Run date: 2026-07-03

This proof exercises the walletless creator path against a local Tollgate dev
server with live Circle W3S credentials loaded from `.env.local`. No credential
values are recorded here.

## Evidence

| Step | Screenshot |
| --- | --- |
| Register a source with the wallet field left blank | [01-register-form-blank-wallet.png](custodial-e2e/01-register-form-blank-wallet.png) |
| Registration returns a custodial creator source | [02-registered-status.png](custodial-e2e/02-registered-status.png) |
| Source verification panel shows the meta-tag proof challenge | [03-verify-panel.png](custodial-e2e/03-verify-panel.png) |
| Source becomes verified by the meta tag on the fixture page | [04-verified-source.png](custodial-e2e/04-verified-source.png) |
| A deterministic query cites the custodial source and writes one receipt | [05-answer-cites-custodial-source.png](custodial-e2e/05-answer-cites-custodial-source.png) |
| Withdraw panel reaches the honest zero-claim boundary | [06-withdraw-panel.png](custodial-e2e/06-withdraw-panel.png) |

Structured run artifacts:

- [run-summary.json](custodial-e2e/run-summary.json)
- [claim-response.json](custodial-e2e/claim-response.json)

## Run Details

- Dev server: `http://127.0.0.1:3101`
- Local fixture server: `http://p1-custodial-proof.lvh.me:3102`
- Verification env:
  - `TOLLGATE_VERIFY_SECRET=p1-local-verify-secret`
  - `TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS=1`
- Registration caps were raised for the local run only.
- Source: `p1-custodial-form-proof-20260703162450`
- Custodial wallet: `0xdc661b8a978dd5e6a3f364c269187f0ec97a85a6`
- Custody mode: `circle-w3s`
- Query: `0x3d6230202d592c70`
- Receipts written: `1`

The registration was submitted through the homepage form with the wallet field
blank. The source was then verified through the normal source verification
route using a local `.lvh.me` fixture page that served the expected
`tollgate-verification` meta tag.

## Withdraw Boundary

The claim route was exercised after the source was verified and cited. The
route returned HTTP 200:

```json
{
  "claimed": false,
  "claimableAtomicUsdc": "0",
  "message": "nothing to claim"
}
```

That is the honest local boundary: the creator has a custodial W3S wallet and a
local citation receipt, but the local deterministic query did not create a
FeeRouter-routed on-chain balance. On-chain custodial claim is READY and needs a
routed payout on the funded path before there is a non-zero balance to withdraw.

## Reproduction

1. Start a local fixture server that serves the source page with the expected
   Tollgate meta tag.
2. Start Tollgate with `.env.local` loaded and:

   ```powershell
   $env:TOLLGATE_VERIFY_SECRET = "p1-local-verify-secret"
   $env:TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS = "1"
   npm run dev -- --hostname 127.0.0.1 --port 3101
   ```

3. Register the fixture source through the homepage form, leaving the wallet
   field blank.
4. Open `/sources/<sourceId>` and verify ownership by meta tag.
5. Run `/api/query` for a deterministic query constrained to the custodial
   creator wallet.
6. Open `/answers/<queryId>` and `/creators/<wallet>` to inspect the receipt and
   withdraw panel.
7. POST to `/api/creators/<wallet>/claim`; the local proof should return the
   zero-claim response above until a FeeRouter-routed balance exists.

The local `.lvh.me` verification escape hatch is env-gated and is not active by
default. Normal safe-fetch private host protection remains enabled unless
`TOLLGATE_VERIFY_ALLOW_PRIVATE_HOSTS=1` is set for this local E2E path.
