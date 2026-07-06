# Codex scope — Discoverability & three-integration completeness

Goal: a visitor (or judge) can land anywhere, browse everything that's registered, track any creator's work + earnings even at zero, reach all THREE integrations from the nav, and never see dev cruft. One PR. Full sweep.

All paths are relative to `citations/` unless noted. Read every file before editing it. Match existing style (archival-paper / money-green / gold; Fraunces/Inter/IBM Plex Mono; receipt-as-brand). Run `npm run lint && npm run typecheck && npm test` before finishing. Do NOT touch payment/x402/settlement code or contracts — this is UI/navigation/read-only surface only.

---

## 0. Blocker — remove homepage dev cruft
`src/components/LandingPage.tsx` lines ~90-97: delete the entire `legacy-move-band` block ("Looking for the old homepage tools? #register moved to /register…"). `LegacyHashRedirect` already handles old hash links, so this is redundant. Remove any now-unused CSS class `.legacy-move-band` if it exists only for this block.

---

## 1. `/sources` — public source catalog (NEW page)
No index exists today; sources are direct-URL-only. Create `src/app/sources/page.tsx`:
- Server component, `export const dynamic = "force-dynamic"`. Load `readSources()` from `@/lib/catalog`.
- Render `<SiteNav />` + `<main id="main">` (match the shell/`receipt-page` structure used by `src/app/proof/page.tsx`).
- Grid of source cards. Each card: title, creator + handle, price (use `formatDollars`/existing price formatter), tags, a `verifiedCreator` badge, a `probation`/`origin: "discovered"` badge where applicable, and `shortWallet(wallet)`. Each card links to `/sources/${id}`.
- Distinguish seed/demo sources visually (they already carry `sourceKind: "seed"`; reuse the "Seed/demo" labeling from `src/lib/source-content.ts`) so external registrations stand out.
- Empty state: sensible copy + a "Register a source →" link to `/register` (mirror the empty-state pattern in `EarningsBoard.tsx`).
- Add a filter/sort only if trivial; not required.

Wire it into nav + footer (§5).

---

## 2. `/creators/[wallet]` — real dashboard, not a dead-end
File: `src/app/creators/[wallet]/page.tsx`. `sources` is ALREADY loaded (line 23: `const [ledger, sources] = await Promise.all([readLedger(), readSources()])`).

**Fix the null branch (lines 25-57):** a freshly-registered creator with no receipts currently sees only "No earnings yet" + "Back to Tollgate". Instead, in that branch:
- Compute `mySources = sources.filter(s => s.wallet.toLowerCase() === wallet.toLowerCase())`.
- If `mySources.length > 0`, render a "Your registered work" section listing those sources (same card style as §1, linking to `/sources/${id}` and each source's verify panel).
- Always add onward CTAs even at zero earnings: "Register another source → /register", "Verify ownership" (link to the source page which hosts `SourceVerifyPanel`), "Ask the AI → /ask".
- Keep the "No earnings yet" copy but frame it as "not cited yet", not a terminal state.

**In the populated branch:** also surface `mySources` ("Your registered work") if not already shown, so a creator sees their catalog alongside earnings.

---

## 3. Full, copyable wallet everywhere
No copy component exists yet. Create `src/components/CopyWallet.tsx` (client component, `"use client"`): renders the address (default full; optional `truncate` prop using existing `shortWallet`) + a copy button using `navigator.clipboard.writeText`, with a transient "Copied" state. Match button styling to `.wallet-button`. Accessible: `aria-label="Copy wallet address"`, 44×44 min target.

Use it in:
- `src/app/creators/[wallet]/page.tsx` header (replace/augment the truncated `shortWallet` display; the full wallet already renders once near line 170 — make THAT copyable).
- `src/app/sources/[sourceId]/page.tsx` (~line 92) — show full copyable wallet.
- `src/components/RegisterPanel.tsx` confirmation card (~lines 316-325) — the payout wallet on the REGISTERED receipt should be full + copyable so the creator can save it.

---

## 4. `/video` — third integration page (NEW)
Currently video/PeerTube has ZERO web presence and `/core` says "TWO ways". Create `src/app/video/page.tsx` as a full route (mirror the depth of `/core` and the aperture app's landing):
- `<SiteNav />` + `<main id="main">`, matching page shell/typography.
- Content: what the PeerTube integration is (creators get paid per citation of their video, same settlement core), how it's delivered (the `peertube-plugin-tollgate` npm plugin), install steps, and the PROOF.
- **VERIFY before writing proof claims:** read `../peertube-plugin-tollgate/README.md` and its package.json for the exact npm package name, version, and the on-chain Arc payout tx hash. Do NOT trust any hash from this doc — pull the real one from the plugin repo. Link the tx via the existing `arcscanTxUrl` helper (`@/lib/format`). Link the npm package.
- If a demo video asset/URL exists (check `docs/VIDEO-SCRIPT.md` and ask nothing — if there's a hosted URL use it, else embed nothing and keep the payout proof as the anchor).
- Optional stats panel only if a real data source exists; otherwise omit (do not fabricate live numbers).

---

## 5. Navigation — surface all three integrations
**`src/components/SiteNav.tsx`** (`NAV_LINKS`, lines ~13-18): the primary nav must make the multi-integration story reachable. Add an **"Integrations"** entry pointing to `/core` (the unifying page). Keep the nav to ≤6 items — current set is How it works / Ask the AI / Creators / Proof (+ Register CTA). Add Integrations; if it gets crowded, group Proof + Integrations under the existing structure but do NOT drop existing links. Mobile menu uses the same `NAV_LINKS`, so it inherits automatically — verify parity.

**`/core` page** (`src/app/core/page.tsx`):
- Retitle from "One nanopayment rail. Two ways creators get paid." → **"three ways"**.
- Add a THIRD integration card to `integration-grid`: "integration 03 · video / PeerTube" linking to `/video`. Match the existing two cards' structure.
- Existing card 02 links to `/aperture` — keep, but ensure card 01/02/03 are consistent.

**Footer** (`src/app/layout.tsx`, ~lines 41-54): add "Video licensing → /video" alongside the existing "Photo licensing → /aperture" and "Settlement core → /core". Add "Sources → /sources" and "Judge demo → /demo" (see §6).

**`src/components/LandingPage.tsx`** (`landing-integrations`, ~lines 229-254): currently 2 cards (Citations → /ask, Aperture → /core). Add a THIRD card for video → `/video`. All three cards link to real routes.

---

## 6. Orphan cleanup + cross-app links
- **`/demo`** is in neither nav nor footer (only one in-body link on `/ask`). Add "Judge demo → /demo" to the footer (Proof column). Nav optional.
- **Aperture back-link:** the aperture app (`../aperture/src/app/page.tsx`, its topbar ~lines 28-36) has no link back to the main site. Add a "← Tollgate" / "Citations app" link in Aperture's topbar (mirror how `/core` links back with its "Citations app" button). This is a change in the `aperture/` app — read its nav/topbar first.
- **README** (root `README.md`): line ~5 says "two integrations"; line ~59 says "three". Reconcile to **three**, and make the PeerTube table row honest (it's an npm plugin with on-chain payout proof + now a `/video` page — link the `/video` page as its live surface).

---

## 7. Minor polish (include in this PR)
- `src/app/creators/[wallet]/page.tsx` ~lines 146,165: when `claimable === null` from an RPC failure it renders bare `—`. Add a caption/tooltip "on-chain balance unavailable" so it's not read as zero.
- `src/app/core/page.tsx` ~lines 244-245: aperture proof fetch failure shows "Live stats are warming up." → change to distinguish unavailable from loading (e.g. "Aperture stats unavailable").
- Detail pages (`/answers/[queryId]`, `/sources/[sourceId]`, `/receipts/[hash]`) pass `<SiteNav />` with no `proofOk`, so they hardcode a green "Live" pill. Pass the real ledger-integrity result (as the data-driven pages do with `verification.ok`) so the pill is honest. Verify how `SiteNav` consumes `proofOk` first.
- `src/components/LatestAnswer.tsx`: per-citation cards (~lines 147-158) and the reader-payment hash (~lines 43-69) aren't linked. Link each citation to its `/sources/${id}` and the payment hash to its receipt/Arcscan (use `arcscanTxUrl`), matching `/answers/[queryId]`.

---

## Acceptance
- `/sources` lists all registered sources, linked from nav + footer.
- Register → confirmation → "your earnings board" now shows the creator's registered work + onward CTAs (no dead-end), even at zero earnings.
- Every wallet display is full + copyable.
- `/video` exists, is in nav (via /core) + footer + landing, with a REAL payout-tx proof pulled from the plugin repo.
- `/core`, landing, README all say THREE integrations; all three reachable from the persistent nav within one click of `/core`.
- Homepage has no "old homepage tools" band.
- `npm run lint && npm run typecheck && npm test` all green.
- No changes to payment/settlement/contract code.
