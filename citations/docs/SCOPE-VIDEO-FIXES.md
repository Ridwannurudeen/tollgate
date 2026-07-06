# Codex scope — /video audit fixes (2 blockers + minors)

Audit of commit 2b814a8 passed on mechanics (nav, /sources, CopyWallet, creator dashboard, proofOk threading, 104 tests, build — all verified good). Two blockers must be fixed before deploy. All changes are in `citations/src/app/video/page.tsx` unless noted. Read the file first. Run `npm run typecheck && npm test && npm run build` before finishing. Do NOT touch payment/settlement/contract code.

The tx and FeeRouter address referenced below are the existing constants `PEERTUBE_PAYOUT_TX` and `FEE_ROUTER` at the top of `video/page.tsx` — read them there; do not retype the hashes.

---

## Blocker 1 — `/video` will 500 in production (confirmed on VPS)
`readPluginPackage()` (video/page.tsx:22-38) reads `../peertube-plugin-tollgate/package.json` at request time with **no error handling**. Verified on the VPS: the app deploys standalone to `/opt/tollgate`, so the resolved path `/opt/peertube-plugin-tollgate` does not exist → `readFile` throws → the page 500s. Local passed only because the monorepo sibling dir exists locally.

**Fix:** make the read non-fatal and fall back to static constants, mirroring `core/page.tsx`'s `loadAperture` (which returns `null` on failure). Concretely:
- Define a `FALLBACK_PLUGIN: PluginPackage` constant with the real known values (verify them against `../peertube-plugin-tollgate/package.json`: `name: "peertube-plugin-tollgate"`, `version: "0.1.0"`, a short `description`, `engine: { peertube: ">=6.0.0" }`, `engines: { node: ">=20" }`).
- Wrap the `readFile`/parse in `try/catch`; on any failure (or missing fields) `return FALLBACK_PLUGIN` instead of throwing. The page must render identically whether or not the plugin dir is present.
- Confirm no other unguarded fs read remains in the page.

---

## Blocker 2 — payout proof overstates; reframe honestly
The `PEERTUBE_PAYOUT_TX` constant IS a real on-chain tx (verified: status success, `to` = the `FEE_ROUTER` address). BUT it is not traceable to a plugin-triggered payout: it appears nowhere in `peertube-plugin-tollgate/` except reused here, and the plugin's own `peertube-plugin-tollgate/demo/VALIDATION.md` records its validation run as `payoutsEnabled:false, receiptCount:0` — *"No private operator key was configured, so no on-chain payout was attempted."* Presenting it flatly as **"payout tx / status: success"** under the PeerTube integration claims something the plugin has not demonstrated.

**Fix — reframe the evidence section (video/page.tsx ~115-145) to be exactly honest, without deleting the real tx:**
- Relabel the tx row from "payout tx" → **"Arc FeeRouter routing tx"** (or "settlement-core tx"). It proves the shared settlement rail works on Arc, not that the plugin triggered it.
- Remove or requalify the bare **"status: success"** row so it doesn't read as a completed *PeerTube* payout. If kept, label it "FeeRouter tx status" so it's clearly about the rail, not the plugin flow.
- Add one honest line near the proof (matching the page's existing copy tone): the plugin's download-gating, config, and `/router/proof` endpoint are validated locally (cite `demo/VALIDATION.md`); a full plugin-triggered on-chain payout is pending an operator key. Do not claim receipts/payouts the plugin hasn't produced.
- **README** (root `README.md` line ~65): change the PeerTube row's "Arc pay tx" wording to match — it is a FeeRouter routing tx / shared-rail proof, not a plugin-triggered payout. Keep the tx hash (it's real).

Keep it truthful and non-defensive — the honest framing is still strong (real npm plugin, local validation, shared on-chain rail).

---

## Minor (include in same commit)
- **Version drift:** video/page.tsx line ~65 hardcodes `<strong>0.1.0</strong>` and `{"PeerTube >= 6.0.0"}` while lines ~86/90 render `pluginPackage.version` / `pluginPackage.engine?.peertube` dynamically. Use the dynamic values (`pluginPackage.version`, `pluginPackage.engine?.peertube ?? ">=6.0.0"`) in the signature stat so they can't diverge on a version bump.
- **External link:** `core/page.tsx` ~96-100 — the Arcscan FeeRouter `<a>` has no `target="_blank" rel="noreferrer"` (every other external link does). Add it.

---

## Acceptance
- `/video` renders with the plugin dir absent (simulate: temporarily rename the sibling dir, or unit-check the fallback) — no 500.
- No row on `/video` claims a plugin-triggered payout or "success" payout; the real FeeRouter tx remains, honestly labeled.
- README PeerTube row wording matches the reframed claim.
- Version shown on `/video` is sourced dynamically; `/core` FeeRouter link opens in a new tab.
- `npm run typecheck && npm test && npm run build` green. No payment/settlement/contract changes.
