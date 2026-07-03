# Music Lane Design

This lane is design-only in the current wave.

## Target

Navidrome is the first music target because it is self-hosted, has an active API surface, and stores listening events in a database-backed server rather than a browser-only client.

## Practical Integration

Preferred path:

1. Run a Tollgate sidecar beside Navidrome.
2. Read scrobble/listen events from Navidrome's persisted data or a ListenBrainz-compatible submission path where the operator enables it.
3. Map track identifiers to creator wallets.
4. Settle one receipt per listen or per aggregated listening window.
5. Expose a proof endpoint and verifier like Aperture.

The final event source should be verified against the exact Navidrome deployment before implementation. The design does not assume a browser event as payout evidence.

## Registry

```json
[
  {
    "trackId": "navidrome-track-id",
    "mbid": "musicbrainz-recording-id",
    "title": "Track title",
    "artist": "Artist",
    "wallet": "0x7777777777777777777777777777777777777777",
    "priceAtomicUsdc": 250
  }
]
```

`mbid` is preferred when available; `trackId` is the local fallback.

## Settlement Model

- Per-listen baseline: one listen emits one receipt.
- User-centric split: a listener's monthly budget is allocated pro-rata across tracks they actually listened to.
- Anti-abuse: cap repeated listens per user/track/window, ignore sub-threshold playback, and require server-side scrobble evidence.

## Receipt Fields

Music receipts should include:

- `trackId`
- optional `mbid`
- `artist`
- `listenerHash`
- `playedAt`
- `playDurationSeconds`
- `amountAtomicUsdc`
- `previousHash`
- `receiptHash`

Raw listener identifiers must not appear in public proof output.
