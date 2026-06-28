# Threat Model

## Assets

- Creator payout ledger integrity.
- x402 reader/source payment evidence.
- Immich shared-link download metering.
- Creator wallet registry and ownership labels.
- FeeRouter split/payment evidence.

## Trusted Inputs

- Citations: verified x402 payment headers and server-side settlement code.
- Aperture: nginx access-log archive download events, then Immich shared-link resolution through `resolveSharedLink`.
- Ledger verification: hash-linked receipt payloads and previous hashes.

## Untrusted Inputs

- Browser UI claims, localStorage, and client-side click state.
- Self-registered source metadata until wallet-signature verification is present.
- Aperture owner-to-wallet mappings until operator approval or wallet-signature approval is present.
- Any raw shared-link key, IP address, user-agent, API key, or private key in public output.

## Implemented Controls

- Citations reader/source payments distinguish `local-proof`, `x402-verified`, `x402-settled`, and `forum-routed`.
- Citations receipts bind query id, source id, creator wallet, amount, settlement mode, optional payer/transaction, previous hash, and receipt hash.
- Aperture computes `eventId` from shared-link id, asset id, hashed viewer fingerprint, and a 10-minute window.
- Aperture stores `sharedLinkKeyHash` and `rawAccessLogHash`; it does not store raw shared-link keys or raw access-log lines in receipts.
- Aperture idempotency checks existing `eventId` before settlement.
- Aperture ignores missing/non-2xx archive events before payout.
- Both ledgers serialize read-modify-write appends inside each app process.
- FeeRouter routing uses the `createSplit` simulation result and persists one split per creator wallet for reuse.
- Creator/source records are labeled as external, seed, or internal-test; verified creator status requires wallet-signature proof in Citations and operator/wallet approval in Aperture.
- Aperture `POST /aperture/api/license-download` returns x402 payment requirements before unlock and records receipts after verified/local-proof unlock.

## Known Limits

- File-ledger locking is in-process only; production should run one writer per app instance or move ledgers to a transactional store.
- Credentialed `x402-settled` and Gateway paths require facilitator/Gateway credentials and are user-run on the VPS.

## Privacy

Public proofs should expose hashes and settlement evidence, not raw IP addresses, raw user agents, raw shared-link keys, private keys, or provider credentials.
