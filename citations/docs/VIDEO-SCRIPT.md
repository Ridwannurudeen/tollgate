# Tollgate - demo video

**A first cut exists**: `tollgate-demo-video-2026-07-12.mp4` (66s, silent/captioned, no voiceover — this session had no audio-synthesis capability). It leads with judge-strict agency, counterfactual contribution, PayGate's atomic anchor+pay, the no-secret verifier, and the measured benchmark, in that order — the material that survived a hostile two-pass audit this session, not the broadest feature tour. Every screenshot and number in it is real, captured live against production the same day (queries `0x985d71b75fd8d992` and `0xf69327b2cce382a4`, PayGate tx `0x45169aec...2df2da316`, `judge:verify` 23/23).

**If a proper voiceover cut is recorded, follow this script** — same structure, spoken narration instead of on-screen captions. Target 2:00-2:30. Lead with the creator problem, close with the URL.

**Tabs to pre-open:** `tollgate.gudman.xyz` (scroll to the "Run the verified judge demonstration" panel), `tollgate.gudman.xyz/answers/<queryId-from-your-live-run>`, a terminal with `npm run judge:verify` ready to run, `testnet.arcscan.app` (for the PayGate tx).

---

### 0:00-0:15 - The problem
**Show:** the homepage hero.
**Say:** "Creators earn nothing when an AI reuses their work. Tollgate makes an agent pay for what it uses — and makes every part of that decision provable."

### 0:15-0:45 - A real economic decision, on camera
**Show:** click "Run the verified judge demonstration" live. Let it run (~25-30s) rather than cutting away.
**Say:** "One click runs a real, live agent decision. No wallet, no login. If the model fails, it fails visibly — never a silent fake answer." While it runs: "Five priced candidates. The agent buys some, skips others, by relevance under a hard budget."

### 0:45-1:10 - Paid for proven usefulness, not just cited
**Show:** the resulting answer page's claim/contribution table.
**Say:** "Creators aren't paid because they were cited. Remove a source, re-verify the claims — the more the answer actually breaks without it, the more it earns. Computed for real, per query, not estimated."

### 1:10-1:40 - The spend cap is now law
**Show:** the answer page's signed use-intent block, then the PayGate transaction on Arcscan (registry + USDC + FeeRouter + PayGate all logging in one tx).
**Say:** "One atomic transaction anchors the signed intent, enforces its spend cap, and pays every creator. A bad signature or an over-cap request reverts the whole thing — funds included. This isn't a receipt after the fact. It's the payment gate itself."

### 1:40-2:00 - Nothing to trust, only to check
**Show:** run `npm run judge:verify` in a terminal, let it print the full PASS list.
**Say:** "No API key, no login. It re-derives every hash and reads every transaction straight from Arc. You don't have to believe us."

### 2:00-2:20 - The number
**Show:** a stat card or `docs/BENCHMARK.md`: 3.6x supported claims per $0.01 vs. deterministic baseline, 50/50 measured, 0 errors.
**Say:** "Measured against a fixed 50-question benchmark: the strict live agent produces 3.6 times more useful evidence per dollar than a dumb baseline, and cut wasted purchases from 57% to 15%."

### 2:20-2:30 - Close
**Show:** the live URL.
**Say:** "Every claim in this video is reproducible. Verify it yourself at tollgate.gudman.xyz."

---

## Capture checklist
- Keep the final cut under 2:30.
- The judge-demo button and `judge:verify` must run live/real on camera — don't fake either.
- Show the actual PayGate transaction on Arcscan, not just the app's own summary of it.
- Drop Aperture/PeerTube/WordPress entirely, or one throwaway mention at most — the rubric and this session's audit both point at agentic sophistication + innovation as the strongest, most defensible material, not integration breadth.
