# Registry Drift Investigation

P2 was run read-only against the VPS. No files under `/opt/tollgate` or `/tmp`
were modified.

## Commands And Evidence

- `ssh root@75.119.153.252 "TZ=UTC stat ..."` on
  `/opt/tollgate/data/sources.json`, `sources.json.corrupt.bak`, and
  `ledger.json`.
- `ssh root@75.119.153.252 "TZ=UTC find /tmp ..."` for
  `/tmp/tollgate-data-backup-*.tgz`.
- `ssh root@75.119.153.252 "tar -xOzf ... data/sources.json"` streamed each
  backup member without extracting it on the VPS.
- Local Node fetched `https://tollgate.gudman.xyz/api/sources` and compared
  that response with the live ledger streamed over SSH.
- Local Node parsed the valid JSON prefix of
  `/opt/tollgate/data/sources.json.corrupt.bak`; the file itself is malformed
  and was not changed.

## Current State

- `/opt/tollgate/data/sources.json`
  - mtime: `2026-07-02 10:47:10 UTC`
  - size: `3583` bytes
  - sha256 prefix: `41e55cd3bd28`
  - rows: 3 dynamic external sources
- Live `/api/sources`
  - rows: 9 total
  - composition: 6 default seed sources from `DEFAULT_CREATOR_SOURCES` plus
    the 3 dynamic external rows in `data/sources.json`
- `/opt/tollgate/data/ledger.json`
  - mtime: `2026-07-03 16:05:06 UTC`
  - rows: 69 queries, 188 receipts
  - source IDs referenced by ledger: 20

The current dynamic registry rows are:

| Source ID | Creator | Wallet | Price |
| --- | --- | --- | --- |
| `citepay-agent-commerce-network-hire-specialized-ai-agents-with-u` | CitePay Markets | `0x5389688243328c26a92b301faEEAb5fbf9AFf105` | 1000 |
| `driplet-pay-per-second-live-stream-monetization-on-arc` | Rising Technology | `0xa7ECAd8Fc295183AF2FB60295a7F1417f4037308` | 1500 |
| `shadow-float-v2-live-external-agent-board` | qdee | `0xBDb1e0718EC6f6e2817c9cd4e5c5ed25Ac191Fb8` | 1500 |

## Backup Comparison

Available `/tmp` backups:

| Archive | UTC mtime | Size | `data/sources.json` result |
| --- | ---: | ---: | --- |
| `/tmp/tollgate-data-backup-20260703-093425.tgz` | `2026-07-03 07:34:28` | 99814 | same 3 current rows |
| `/tmp/tollgate-data-backup-20260703-093451.tgz` | `2026-07-03 07:34:53` | 99814 | same 3 current rows |
| `/tmp/tollgate-data-backup-20260703-154806.tgz` | `2026-07-03 13:48:10` | 99814 | same 3 current rows |
| `/tmp/tollgate-data-backup-20260703-161252.tgz` | `2026-07-03 14:12:55` | 99814 | same 3 current rows |

Every available backup has the same `data/sources.json` hash prefix as the
current file (`41e55cd3bd28`). The earliest available backup is already
post-drift, so these backups cannot restore the pre-drift registry by
replacement.

Each archive also contains `data/sources.json.corrupt.bak`. That file has a
valid 1808-byte JSON array prefix plus 9 trailing invalid bytes. The valid
prefix contains exactly three old rows:

| Source ID | Creator | Wallet | Price |
| --- | --- | --- | --- |
| `leptonweb-build-log` | LeptonWeb Lab | `0xc9F2A6146cff81735925825b192ad6cdA4059c3c` | 1700 |
| `shadow-float-qdee-20260623` | qdee | `0xBDb1e0718EC6f6e2817c9cd4e5c5ed25Ac191Fb8` | 1500 |
| `citepay-on-chain-audit-verifiable-citation-receipts-on-arc` | CitePay Markets | `0x5389688243328c26a92b301faEEAb5fbf9AFf105` | 1000 |

Those rows predate the current `CreatorSource` schema. They include original
`summary` and `tags`, but they do not include required current fields such as
`sourceKind`, `creatorKind`, and `verifiedCreator`, so copying the file back as
is would still be filtered by the current app.

## Timeline

- `2026-06-16` to `2026-06-24`: the missing sources were cited and paid in the
  live ledger.
- `2026-06-24 04:19:57 UTC`: `sources.json.corrupt.bak` mtime. Its valid
  prefix proves at least three old dynamic rows existed on disk at this point.
- `2026-07-02 10:47:10 UTC`: current `sources.json` was written with only the
  three current external rows. This is before the July 3 deploy work.
- `2026-07-03 07:34:28 UTC`: earliest available `/tmp` backup already contains
  only the three current external rows.

Conclusion: the available backups bound the drift to before
`2026-07-03 07:34:28 UTC`, and the current file mtime points to
`2026-07-02 10:47:10 UTC` as the likely write time. The exact overwrite event is
not recoverable from the available `/tmp` backups.

## Lost Entries

The live ledger references 11 source IDs that are absent from live
`/api/sources`. They account for 84 non-refunded receipts and 125400 atomic USDC
in historical creator payments.

1. `citepay-markets-ai-agent-citation-marketplace-on-arc`
   - Title: CitePay Markets — AI Agent Citation Marketplace on Arc
   - Creator: CitePay Markets, `@citepay`
   - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
   - URL: `https://citepay-markets.vercel.app/`
   - Price: 1200 atomic USDC
   - Receipts: 21, total 25200 atomic USDC
   - First/last seen: `2026-06-24T14:40:07.331Z` to
     `2026-06-24T20:36:19.930Z`
   - Recovery source: ledger latest citation snapshot

2. `leptonweb-build-log`
   - Title: LeptonWeb Build Log
   - Creator: LeptonWeb Lab, `@ggudman`
   - Wallet: latest/corrupt backup wallet
     `0xc9F2A6146cff81735925825b192ad6cdA4059c3c`; older receipts also cite
     `0x22949cA9A470181c66a034E81a743E2518579E95`
   - URL: `https://forum.gudman.xyz/`
   - Price: 1700 atomic USDC
   - Receipts: 12, total 20400 atomic USDC
   - First/last seen: `2026-06-16T14:18:27.470Z` to
     `2026-06-23T14:52:54.366Z`
   - Recovery source: valid prefix of `sources.json.corrupt.bak` plus ledger

3. `citepay-natural-language-policy-builder`
   - Title: CitePay Natural Language Policy Builder
   - Creator: CitePay Markets, `@citepay`
   - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
   - URL: `https://citepay-markets.vercel.app/policy`
   - Price: 1600 atomic USDC
   - Receipts: 9, total 14400 atomic USDC
   - First/last seen: `2026-06-24T14:43:29.031Z` to
     `2026-06-24T17:16:25.148Z`
   - Recovery source: ledger latest citation snapshot

4. `citepay-on-chain-audit-verifiable-citation-receipts-on-arc`
   - Title: CitePay On-Chain Audit — Verifiable Citation Receipts on Arc
   - Creator: CitePay Markets, `@citepay`
   - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
   - URL: `https://citepay-markets.vercel.app/audit`
   - Price: 1000 atomic USDC
   - Receipts: 9, total 9000 atomic USDC
   - First/last seen: `2026-06-24T14:45:55.871Z` to
     `2026-06-24T20:33:50.290Z`
   - Recovery source: valid prefix of `sources.json.corrupt.bak` plus ledger

5. `citepay-autonomous-knowledge-gap-agent-self-improving-citation-m`
   - Title: CitePay Autonomous Knowledge Gap Agent — Self-Improving Citation Market
   - Creator: CitePay Markets, `@citepay`
   - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
   - URL: `https://citepay-markets.vercel.app/orchestrate`
   - Price: 2000 atomic USDC
   - Receipts: 7, total 14000 atomic USDC
   - First/last seen: `2026-06-24T14:54:59.775Z` to
     `2026-06-24T17:14:41.848Z`
   - Recovery source: ledger latest citation snapshot

6. `citepay-mcp-server-claude-tool-for-paid-citation-queries`
   - Title: CitePay MCP Server — Claude Tool for Paid Citation Queries
   - Creator: CitePay Markets, `@citepay`
   - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
   - URL: `https://citepay-markets.vercel.app/mcp`
   - Price: 1400 atomic USDC
   - Receipts: 6, total 8400 atomic USDC
   - First/last seen: `2026-06-24T14:40:07.331Z` to
     `2026-06-24T17:16:25.148Z`
   - Recovery source: ledger latest citation snapshot

7. `citepay-economic-intelligence-dashboard-live-ai-knowledge-econom`
   - Title: CitePay Economic Intelligence Dashboard — Live AI Knowledge Economy Analytics
   - Creator: CitePay Markets, `@citepay`
   - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
   - URL: `https://citepay-markets.vercel.app/intelligence`
   - Price: 1900 atomic USDC
   - Receipts: 5, total 9500 atomic USDC
   - First/last seen: `2026-06-24T14:54:06.231Z` to
     `2026-06-24T17:13:51.424Z`
   - Recovery source: ledger latest citation snapshot

8. `citepay-knowledge-bounties-usdc-funded-crowdsourced-ai-knowledge`
   - Title: CitePay Knowledge Bounties — USDC-Funded Crowdsourced AI Knowledge Gaps
   - Creator: CitePay Markets, `@citepay`
   - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
   - URL: `https://citepay-markets.vercel.app/bounties`
   - Price: 1700 atomic USDC
   - Receipts: 4, total 6800 atomic USDC
   - First/last seen: `2026-06-24T17:10:40.875Z` to
     `2026-06-24T17:13:02.228Z`
   - Recovery source: ledger latest citation snapshot

9. `citepay-research-sessions-contextual-multi-turn-ai-research-with`
   - Title: CitePay Research Sessions — Contextual Multi-Turn AI Research with Paid Receipts
   - Creator: CitePay Markets, `@citepay`
   - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
   - URL: `https://citepay-markets.vercel.app/session`
   - Price: 1800 atomic USDC
   - Receipts: 4, total 7200 atomic USDC
   - First/last seen: `2026-06-24T14:50:51.143Z` to
     `2026-06-24T14:53:17.549Z`
   - Recovery source: ledger latest citation snapshot

10. `shadow-float-qdee-20260623`
    - Title: Shadow Float: Spend Before Funding
    - Creator: qdee, `@qdee`
    - Wallet: `0xBDb1e0718EC6f6e2817c9cd4e5c5ed25Ac191Fb8`
    - URL: `https://shadow-arc.vercel.app/float`
    - Price: 1500 atomic USDC
    - Receipts: 4, total 6000 atomic USDC
    - First/last seen: `2026-06-23T14:17:09.684Z` to
      `2026-06-24T14:48:25.721Z`
    - Recovery source: valid prefix of `sources.json.corrupt.bak` plus ledger

11. `citepay-live-auction-citation-price-discovery`
    - Title: CitePay Live Auction — Citation Price Discovery
    - Creator: CitePay Markets, `@citepay`
    - Wallet: `0x5389688243328c26a92b301faEEAb5fbf9AFf105`
    - URL: `https://citepay-markets.vercel.app/auction`
    - Price: 1500 atomic USDC
    - Receipts: 3, total 4500 atomic USDC
    - First/last seen: `2026-06-24T14:54:59.775Z` to
      `2026-06-24T17:14:41.848Z`
    - Recovery source: ledger latest citation snapshot

## Restoration Proposal

Recommended restore: merge, do not replace.

1. Keep the three current dynamic rows in `/opt/tollgate/data/sources.json`.
   They are newer live external registrations and are not present in the old
   corrupt backup prefix.
2. Add the 11 lost source IDs above as additional dynamic rows.
3. Use the valid prefix of `sources.json.corrupt.bak` as the source of
   `summary` and `tags` for:
   - `leptonweb-build-log`
   - `shadow-float-qdee-20260623`
   - `citepay-on-chain-audit-verifiable-citation-receipts-on-arc`
4. Use the ledger latest citation snapshots as the canonical identity and price
   source for the remaining eight rows: `id`, `title`, `creator`, `handle`,
   `wallet`, `url`, and `priceAtomicUsdc`.
5. Rehydrate missing `summary` and `tags` for those eight rows from current
   source-page content or creator-provided copy. A local GET probe on
   `2026-07-03` returned HTTP 200 `text/html` for the CitePay source URLs, so
   content rehydration is feasible, but those summaries/tags were not present in
   the available backups or ledger.
6. Normalize every restored row to the current `CreatorSource` schema:
   - `sourceKind: "external"`
   - `creatorKind: "external"`
   - `origin: "registered"`
   - `registeredAt`: first ledger-seen timestamp for that source
   - `verifiedCreator: false` and `probation: true` unless a stored ownership
     proof is recovered or the creator re-verifies by wallet signature,
     meta-tag, or DNS TXT.
7. For `leptonweb-build-log`, prefer wallet
   `0xc9F2A6146cff81735925825b192ad6cdA4059c3c` because it appears in the
   corrupt backup and latest ledger snapshot. Preserve the older
   `0x22949cA9A470181c66a034E81a743E2518579E95` only in the report; do not
   create a second source row for it.

Do not restore by untarring any available `/tmp/tollgate-data-backup-*.tgz`
over the live data directory. Every available archive is already post-drift and
would keep the same three-row dynamic registry.

## Post-Restore Checks

After Claude and the user approve a restore, the minimum checks should be:

- Back up the current live `sources.json` before writing.
- Run a local JSON/schema validation against the merged file with the current
  `isCreatorSource` requirements.
- Confirm `/api/sources` returns 20 rows: 6 seed rows plus 14 dynamic rows.
- Confirm the three current external rows remain present.
- Confirm `/sources/leptonweb-build-log`,
  `/sources/citepay-markets-ai-agent-citation-marketplace-on-arc`, and
  `/sources/shadow-float-qdee-20260623` return HTTP 200.
- Confirm ledger integrity still reports 69 queries and 188 receipts.
