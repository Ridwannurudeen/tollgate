# Tollgate Roadmap

Tollgate is moving from hackathon proof to a reusable creator-payment protocol.

## Wave 0: Make The Core True

- Escrow payouts for unverified sources until ownership verification clears them.
- Migrate ledgers from JSON to SQLite while preserving hash-chain verification.
- Add registration caps, probation, duplicate guards, and content checks.
- Keep PeerTube validation gated by a real Docker environment.
- Add a swappable signer seam for local keystore and Circle W3S.

## Wave 1: Creator UX

- Register work without a crypto wallet by minting a custodial payout wallet when operator credentials are configured.
- Withdraw from the creator page.
- Verify ownership with wallet signatures, meta tags, or DNS TXT records.
- Import RSS/Atom feeds into priced sources.
- Show earnings, receipts, source mix, publisher snippets, and claimable balances.
- Record refunds when a bought source is not cited in the final answer.
- Support multi-contributor payout splits.

## Wave 2: Demand Side

- `@tollgate/reader` SDK for agents and apps.
- MCP server so MCP-capable agents can ask Tollgate directly.
- Open-web discovery through `/.well-known/tollgate.json` and meta tags.
- Embeddable publisher answer widget.

## Wave 3: New Lanes And Specs

- Jellyfin per-minute VOD sidecar.
- Music lane design for Navidrome/scrobble-based settlement.
- Public discovery and receipt specs.

## Boundaries

No mainnet rollout, package publishing, VPS deployment, or community submission happens without explicit operator approval.
