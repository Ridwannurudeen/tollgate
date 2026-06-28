# Traction

Refresh this file from live endpoints before submission. Do not copy old numbers forward without rechecking.

## Categories

| Category | Definition | Source |
| --- | --- | --- |
| External creators | Creator/source entries with verified external ownership | `/api/sources`, proof pack |
| Seed creators | Demo or project-controlled entries | `/api/sources`, proof pack |
| Internal-test wallets | Wallets used for demos, operators, or proof runs | funding/proof metadata |
| Paid queries | Queries with reader-payment evidence | `/api/settlement/status`, proof pack |
| Payout receipts | Hash-linked creator payout receipts | `/proof`, ledger verification |
| Unique payer wallets | Distinct payer addresses in reader/source payments | proof pack |
| Unique creator wallets | Distinct creator payout wallets | proof pack |
| Total test USDC | Sum of testnet reader/source/payout amounts, separated by category | proof pack |

## Current Values

| Metric | Value |
| --- | --- |
| External creators | user refresh |
| Seed creators | user refresh |
| Internal-test wallets | user refresh |
| Paid queries | user refresh |
| Payout receipts | user refresh |
| Unique payer wallets | user refresh |
| Unique creator wallets | user refresh |
| Total test USDC routed | user refresh |

## Rule

Seed and internal wallets are proof fixtures, not user traction.
