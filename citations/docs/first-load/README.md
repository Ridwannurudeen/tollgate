# First-Load Choreography Evidence

- `live-home-before-p4.png` - production first viewport before the P4 code deploy gate.
- `local-home-after-p4.png` - local first viewport after P4, using a temporary copy of the live source registry to verify the three external creators render above the fold.

Verification notes:

- Ticker ordering is covered by `src/lib/first-load.test.ts`; receipts now sort newest-first with append order as a tie-breaker for equal timestamps.
- External creator visibility is covered by `src/lib/first-load.test.ts`; the first-load strip renders only verified external creators, capped at three.
- The temporary local source registry was restored after screenshot capture; `citations/data/` has no committed diff.
