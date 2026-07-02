# Traction

All figures below were read live from the deployed ledger and verified on-chain on Arc testnet (chain `5042002`). Refresh before submission via `/api/settlement/status`, `/api/sources`, and `npm run verify:ledger`.

## Headline: real external creators, paid on-chain

Three independent external creators onboarded through the public self-serve flow, each proved wallet control with a signed ownership message (`verifiedCreator: true`), and each has been cited by the live answer agent and paid in USDC on Arc through the on-chain FeeRouter. Two of them (CitePay and qdee) completed onboarding **autonomously with their own agents** — claiming their balance and registering a new verified source with no hand-holding.

| Creator | Wallet | Verified source | Paid on-chain | Receipts |
| --- | --- | --- | --- | --- |
| CitePay Markets | `0x5389…F105` | `citepay-agent-commerce-network-…` | 0.10 USDC | 69 |
| qdee (Shadow Float) | `0xBDb1…1Fb8` | `shadow-float-v2-live-external-agent-board` | 0.0075 USDC | 5 |
| Rising Technology (Driplet) | `0xa7EC…7308` | `driplet-pay-per-second-live-stream-…-on-arc` | 0.0015 USDC | 1 |

Representative on-chain payout tx (FeeRouter → creator split), verify on `https://testnet.arcscan.app`:
- CitePay: `0xc5074b…16509f`
- qdee (new source citation, query `0xe7c1a7…`): `0xa03809…748e6`
- Rising Technology (same query): `0x064b73…2468e6`

Each creator can withdraw with `FeeRouter.claim()`; CitePay and qdee have already claimed real balances on-chain.

## Ledger totals (live, verified)

| Metric | Value |
| --- | --- |
| Answered queries | 65 |
| Payout receipts | 176 |
| Distinct creator wallets paid | 11 |
| Total USDC routed to creators | 0.3071 |
| Ledger integrity (`verify:ledger`) | `ok: true`, 0 issues, latest hash `0xfa7580…a219e2` |

## Cross-project interop (agent-to-agent, on-chain)

- **Tollgate → CitePay:** the Tollgate demo-payer sent 5 real x402 DirectTransfer paid queries to CitePay's live endpoint (external paid provider), settled on Arc.
- **Tollgate/Forum → Shadow Float V2:** Tollgate acted as the first non-operator external sponsor on qdee's Shadow Float V2 contract — full open-line → agent-signed spend → repay → close/reclaim loop settled on Arc, reserve returned in full.

## Honest framing (do not overclaim)

- What is real and verifiable: **external creators onboarded, cryptographically verified, cited by the live agent, and paid real USDC on-chain**, plus two-way cross-project settlement.
- What is not yet claimed: broad **external reader demand**. Most query volume is driven by our own agent / demand engine (payer = the server operator wallet), not by third-party readers paying. The traction story is external-creator supply + on-chain settlement, not paid external readership.
- Not counted as traction: the seed sources in `catalog.ts` (project fixtures) and the `LeptonWeb Lab` self wallet. Only the three creators above are independent third parties.
