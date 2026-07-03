# Security

Tollgate is a public demo stack for Arc testnet creator payments. Do not commit private keys, mnemonics, API keys, wallet set IDs, or live `.env` files.

## Boundaries

- Citations accepts x402 reader/source payments through signed payment headers and records creator payout receipts in `citations/data/ledger.json`.
- Aperture treats server-side Immich/nginx archive-download logs as the trusted metering source. Browser clicks are not accepted as payout proof.
- Public proof pages expose hashes, receipt metadata, wallet addresses, and transaction references. They must not expose raw private keys, mnemonics, access tokens, raw IP addresses, or raw user agents.

## Current Settlement Modes

- `local-proof`: receipt hash only; not final settlement.
- `x402-verified`: payment authorization verified; not settled by this runtime.
- `x402-settled`: facilitator/Gateway settlement completed.
- `forum-routed`: creator payout routed through Forum FeeRouter.
- `escrowed`: payout recorded but withheld until ownership verification.
- `refunded`: bought source was not cited in the final answer.

UI and docs must use these labels exactly and must not call verified-only or local-proof flows settled.

## Secrets

Use environment variables from `citations/.env.example` and `aperture/.env.example`. Keep real values in local or server-only env files, never in git.

## Source Registration

External source registration, RSS import, and open-web discovery are untrusted inputs. New external sources start on probation; optional content fetches reject local/private hosts; ownership verification requires wallet signature, meta tag, or DNS TXT proof. Notification email is private metadata and must not be included in proof packs or public APIs.

## Reporting

For this hackathon repo, report security issues directly to the maintainer before public disclosure.
