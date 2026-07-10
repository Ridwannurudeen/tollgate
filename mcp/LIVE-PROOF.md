# Reader MCP live proof: an agent paying as a customer

Verified on 2026-07-10 against **production** `https://tollgate.gudman.xyz` (not a local dev server) on Arc testnet chain `5042002`, using a fresh throwaway payer key generated for this run and funded once by the operator. The key was used only for this proof and is considered burned afterward.

This closes the one gap the `pay-per-piece` toy-paywall proof didn't cover: proving the **demand side** — an agent autonomously paying Tollgate as a customer through the published reader tooling (`mcp`'s `tollgateAsk`), not a creator receiving a payout.

- Payer (throwaway): `0xea33A2F3E1c0afB04F1911702827D37C31793882`
- Funding: 20 Arc testnet USDC + 20 native (operator-funded, manual step — the TestMint faucet is a wallet-connect UI, not scriptable)
- Question asked: *"How does Tollgate's FeeRouter prove a citation payout with an on-chain receipt?"*
- Run via: `mcp/dist/tools.js` → `tollgateAsk()` → `createPaidFetch()` (`@x402/evm` `ExactEvmScheme`, the same x402 client code a real MCP-connected agent would invoke through the `tollgate_ask` tool)

## What happened, end to end

1. The agent's answer engine picked 3 candidate sources by relevance/budget, spent `10000` atomic USDC (`0.01 USDC`) total via **x402 exact-scheme** settlement.
2. Only 1 of the 3 purchased sources was actually cited in the final answer; the other 2 were **refunded automatically** (`refundedAtomicUsdc: 3700`) — Tollgate's no-citation-no-charge policy working exactly as documented, not just as a claim.
3. The cited source's creator payout settled through the on-chain FeeRouter split (`forum-routed`).

## On-chain verification (independent, via `eth_getTransactionReceipt`, not arcscan's indexer which lagged)

| Transaction (truncated) | Purpose | Status | Block |
|---|---|---|---|
| `0x1c576a6e75c1…59812d39` | Reader's x402 payment (USDC contract) | `success` | 51138876 |
| `0xc4836ef14134…2ac3044a2bf` | FeeRouter split (pre-existing, split 167) | `success` | 50489681 |
| `0x251551387b3f…199e5b8fb4bf9` | FeeRouter `pay()` to creator split | `success` | 51138902 |

Balance deltas confirmed independently by reading `balanceOf`/`totalClaimableOf` directly:
- Payer USDC: `20.00 → 19.99` (spent exactly `0.01` USDC, matching `readerPayment.amountAtomicUsdc: 10000`)
- Creator (`Receipt Ledger Notes`, `0x8888…8888`) FeeRouter claimable balance: non-zero after the pay tx, consistent with the new payout landing

## Query/receipt proof URLs (public, no auth)

- `https://tollgate.gudman.xyz/proof`
- `https://tollgate.gudman.xyz/answers/0x5eecb2770b55c11e`
- `https://tollgate.gudman.xyz/receipts/0x6bfe3b29cefe492f…9ca6bd09d` (the settled, non-refunded receipt)

## What this proves vs. the toy-paywall proof

- `pay-per-piece`'s `LIVE-PROOF.md` proves the **supply side**: a creator can get paid through the published SDK, outside Citations/Aperture.
- This proof covers the **demand side**: an independent agent process, using only the published `mcp`/reader tooling and a throwaway key with zero access to production `data/` or the hot wallet, can autonomously pay Tollgate as a customer and have the payment settle for real, on-chain, against the live production deployment — not a local fixture.

Together, both proofs cover RFB1/RFB2 (agent-as-payer) with real settlement evidence, not just working code.
