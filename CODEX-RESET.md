# ⚠ Codex: your Aperture clone is STALE — reset to this repo before any work

Your working clone at commit `49839b7 "Mount Aperture under Tollgate"` is **behind production and contains a fixed bug**. Do NOT build, commit, or redeploy from it. Reset to this repo (it matches the live deployment on the VPS at `/opt/aperture`).

## What changed since 49839b7 (and is NOT in your clone)
1. **Double-pay bug fixed in `src/lib/watcher.ts`.** Previously `settle()` ran *before* the de-dup check, so a de-duped resolve event still paid on-chain and the forum-routed evidence was discarded (ledger stayed `local-proof`). The fix adds an injectable `findExistingReceipt` and **peeks for an existing receipt before settling** (idempotent — same access-log line never double-pays). This is the single most important change. If you redeploy your old `watcher.ts`, you reintroduce on-chain double-payments.
2. **On-chain settlement is live.** A dedicated Aperture Arc payer is funded and `APERTURE_FEE_ROUTER_ENABLED=1` (secrets live only in `/etc/aperture.env` on the box, never in git). Receipts now settle `forum-routed` per download.
3. **Photographer remapped** from the demo wallet to a real user-controlled wallet via `register:owner` (ownerId `751f8862…` → `0xc9F2…`).
4. **Verified live:** 16/16 tests, typecheck, build, `verify:ledger` all pass; a real `forum-routed` receipt exists (tx confirmed on Arc, status 0x1); idempotency confirmed (re-running the same line creates no new payment).

## What to do
- **Reset/re-clone your working copy to THIS repo** (commit `3ff1a98+`). Treat it as the source of truth; it equals `/opt/aperture` on the VPS.
- Never ship `data/` or `/etc/aperture.env` secrets to git.
- Before any redeploy, confirm `grep -c "Idempotency\|findExisting" src/lib/watcher.ts` returns ≥1.

## Source-of-truth rule going forward
Production lives at `/opt/aperture` (deployed) and mirrors this repo. Any change must land in this repo first, then deploy — so production and the clone never diverge again.
