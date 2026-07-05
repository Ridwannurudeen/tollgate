# Traction

All figures below were read live from the deployed ledger and verified on-chain on Arc testnet (chain `5042002`). Refresh before submission via `/api/settlement/status`, `/api/sources`, and `npm run verify:ledger`.

## Headline: real external creators, paid on-chain

Three independent external creators onboarded through the public self-serve flow, each proved wallet control with a signed ownership message (`verifiedCreator: true`), and each has been cited by the live answer agent and paid in USDC on Arc through the on-chain FeeRouter. Two of them (CitePay and qdee) completed onboarding **autonomously with their own agents** — claiming their balance and registering a new verified source with no hand-holding.

| Creator | Wallet | Verified source | Paid on-chain | Receipts |
| --- | --- | --- | --- | --- |
| CitePay Markets | `0x5389…F105` | `citepay-agent-commerce-network-…` | ~0.115 USDC | 86 |
| qdee (Shadow Float) | `0xBDb1…1Fb8` | `shadow-float-v2-live-external-agent-board` | ~0.027 USDC | 20 |
| Rising Technology (Driplet) | `0xa7EC…7308` | `driplet-pay-per-second-live-stream-…-on-arc` | ~0.012 USDC | 10 |

Representative on-chain payout tx (FeeRouter → creator split), verify on `https://testnet.arcscan.app`:
- CitePay: `0xc5074b…16509f`
- qdee (new source citation, query `0xe7c1a7…`): `0xa03809…748e6`
- Rising Technology (same query): `0x064b73…2468e6`

Each creator can withdraw with `FeeRouter.claim()`; CitePay and qdee have already claimed real balances on-chain.

## Ledger totals (live, verified 2026-07-05)

| Metric | Value |
| --- | --- |
| Answered queries | 83 |
| Payout receipts | 230 |
| Priced sources in registry | 21 (15 external, 6 seed fixtures) |
| Verified external creators | 3 of 21 sources (the rest are probationary/unverified) |
| Total USDC routed to creators | ~0.37 |
| Ledger integrity (`verify:ledger`) | `ok: true`, 0 issues |

## External paying readers (2026-07-04, on-chain, all three settled)

Three independent external parties paid Tollgate as readers — real 0.01 USDC each, `x402-settled`,
from their own wallets (not Tollgate's operator wallet). Each is also an earning creator on Tollgate, so
these are reciprocal partner relationships, not cold-stranger demand — but the settlement is genuine.
The three cite each other: each reader's answer paid the other external creators, forming a small
multi-party settlement mesh, all on-chain.

1. **CitePay Markets** — query `0x44dee3a04a09ac6c`, payer `0x5389…F105`, `x402-settled` via the Circle
   Gateway-batched path. Creator payouts to CitePay/qdee/Indie Researcher confirmed on Arc.
2. **Rising Technology (Driplet)** — query `0x166cceb9f617e8ce`, payer `0xb73b…E2BF`, `x402-settled` via
   the **exact-scheme (EIP-3009 direct)** path. Settle tx `0x4db07d688d…1659` (block 50169807) — the
   on-chain USDC Transfer log directly shows the reader wallet debited 0.01 USDC. This path only settles
   because a self-facilitator was configured; Rising Technology's first attempt surfaced that it was
   verify-only, which prompted the fix — a bug-report → fix → verified-resolution cycle with an external
   team, on-chain.
3. **qdee (Shadow Float)** — query `0x1cc650f198d7f7fd`, payer `0x43553…522E`, `x402-settled` via the
   Gateway-batched path. Creator payouts to qdee/CitePay/Rising Technology confirmed on Arc
   (`0xb9298ed3…`, `0x4c66486a…`, `0xa6d7f239…`, all success).

**Verification-depth honesty:** the exact-scheme payment (Rising Technology) is directly Arc-verifiable —
the reader's wallet debit is a single on-chain Transfer. The two Gateway-batched payments (CitePay, qdee)
settle through Circle Gateway's batching, so the reader leg is referenced by a Gateway payment ID (a UUID,
not a single Arc tx hash); their on-chain evidence is the resulting creator-payout transactions, which are
all verified on Arc. All three moved real value; only the exact-scheme one exposes the reader-side debit
as a directly-pullable Arc transaction.

These are the instances of **externally generated, settled reader demand** in the ledger to date — see
"Honest framing" below for how much of the total ledger this represents.

## Cross-project interop (agent-to-agent, on-chain)

- **Tollgate → CitePay:** the Tollgate demo-payer sent 5 real x402 DirectTransfer paid queries to CitePay's live endpoint (external paid provider), settled on Arc.
- **Tollgate/Forum → Shadow Float V2:** Tollgate acted as an external sponsor on qdee's Shadow Float V2 contract twice — full open-line → agent-signed spend → repay → close/reclaim loop settled on Arc both times, reserve returned in full each time.

## Honest framing (do not overclaim)

- **What is real and verifiable:** 3 external creators onboarded, cryptographically verified, cited by
  the live agent, and paid real USDC on-chain; 1 external reader (CitePay) paid Tollgate directly and
  the loop closed on-chain; two-way cross-project settlement with Shadow Float V2.
- **What is NOT yet true, stated plainly:** the majority of reader-payer wallets in the ledger are the
  project's own operator/demo wallet or smoke-test wallets. **Three** are genuine external third parties
  with settled payments (CitePay, Rising Technology, qdee) — but all three are reciprocal partners who
  also earn as creators, not cold-stranger demand. **Reader demand is proven to exist and settle among a
  closed circle of three partners; it is not yet proven at scale, and not yet from any party that has no
  other relationship to us.** Anyone auditing the payment graph on Arcscan will see this, so we say it
  here first.
- **Registry composition:** 21 priced sources exist, but only 3 (14%) are ownership-verified; the
  other 18 include 6 seed/demo fixtures shipped with the code and 12 externally-registered but
  unverified sources (some awaiting the creator's meta-tag/DNS proof, some reconstructed from ledger
  history after a registry-file incident on 2026-07-02 — see `docs/REGISTRY-DRIFT.md`).
- **Not counted as traction:** the 6 seed sources in `catalog.ts` and the `LeptonWeb Lab` self wallet.
  Only the 3 verified creators and the 1 external reader above are independent third parties.
