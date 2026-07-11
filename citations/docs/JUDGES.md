# Judge verification

Run the no-secret verifier first:

```bash
npm run judge:verify
```

To verify another deployment:

```bash
npm run judge:verify -- --url https://example.invalid
```

The command fetches `/api/judge-proof.json` and `/api/ledger`, recomputes the
receipt hash chain and trace hashes locally, cross-checks the proof counts, then
checks the latest settled reader payment, its FeeRouter payout, and FeeRouter
bytecode directly on Arc Testnet. It requires no API keys, wallets, or signing
secrets.

The machine-readable proof source is:

```text
https://tollgate.gudman.xyz/api/judge-proof.json
```

The proof pack includes the deployed commit, agent decision counts, settlement
counts, the complete integrity result, and the public ledger evidence used by
the verifier.
