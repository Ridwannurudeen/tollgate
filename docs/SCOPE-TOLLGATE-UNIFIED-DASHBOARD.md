# Codex scope — unified Tollgate creator dashboard (Aperture + Citations by wallet)

Today Aperture's `/dashboard` shows only Aperture photo earnings. Make it the **whole-product creator dashboard**: a logged-in creator sees their Aperture photos AND their Citations (cite-to-earn) sources + earnings in one place, joined by **wallet address**. Citations and Aperture are separate apps (separate deploys `/opt/tollgate` vs `/opt/aperture`, separate data, no shared code) — the ONLY join key is the wallet. Aperture keeps the login (email/account-key); it reads Citations earnings via a new read-only HTTP endpoint.

**Verified constraints (do not fight these):**
- Citations sources: `citations/src/lib/catalog.ts` `readSources()` (no wallet param — filter yourself). `CreatorSource.wallet` is stored **as-submitted (not checksummed)**; the creator page compares via `.toLowerCase()`. **Join by lowercasing BOTH sides.**
- Citations earnings: `citations/src/lib/ledger.ts` `getCreatorEvidence(ledger, wallet)` → `CreatorEvidence` (`CreatorEarnings`: sourceCount, citationCount, earnedAtomicUsdc, … + receipts/queries/sources). Earned excludes `escrowed`/`refunded` (`isCreatorEarnedReceipt`).
- **Video earnings are NOT per-wallet available** — video settles via the PeerTube plugin's own on-chain FeeRouter, not the citations ledger; `/video` shows a hardcoded proof tx. So video is a **static proof link**, NOT a computed figure. Do not fabricate a per-wallet video number.
- Aperture account wallet (`WalletRegistryEntry.wallet`) is `getAddress`-checksummed; custodial accounts have a MINTED wallet that will NOT match a creator's citations wallet — hence linked-wallets below.
- No existing citations GET summary endpoint (`creators/[wallet]/claim` is POST-only). Must add one.

Run `npm run typecheck && npm test && npm run build` in BOTH `citations/` and `aperture/`. Do NOT touch payment/x402/fee-router/settlement/gate/nginx/preview logic. No new dependencies.

## Part 1 — Citations: read-only per-wallet summary API
`citations/src/app/api/creators/[wallet]/summary/route.ts` (new, `runtime nodejs`, GET):
- Validate `wallet` is `0x`+40 hex; else 400.
- `const ledger = await readLedger(); const evidence = getCreatorEvidence(ledger, wallet);` and `const sources = (await readSources()).filter(s => s.wallet.toLowerCase() === wallet.toLowerCase())`.
- Return `{ wallet, earnings: { sourceCount, citationCount, earnedAtomicUsdc }, sources: sources.map(publicSource) }` — reuse `publicSource` (strips `notifyEmail`/`walletId`). Never return `notifyEmail`, `ownershipProof`, `walletId`.
- Zero-data wallet → `{ wallet, earnings: { sourceCount:0, citationCount:0, earnedAtomicUsdc:0 }, sources: [] }` (200, not 404).
- Light per-IP rate-limit if a limiter exists in citations; else skip (it's public read-only data — the `/creators/[wallet]` page already exposes it).
- `cache-control: public, max-age=30`.

## Part 2 — Aperture: linked wallets on the account
- `aperture/src/lib/types.ts` `WalletRegistryEntry`: add `linkedWallets?: string[]` (extra wallets to aggregate; lowercased, deduped). Extend `isRegistryEntry` (optional array of 0x strings).
- `POST /aperture/api/account/wallets` (session-gated via `getSessionOwner`): body `{ wallet }` → validate 0x+40 hex, lowercase, add to the owner's `linkedWallets` (atomic write, dedupe, cap ~10). `DELETE` with `{ wallet }` removes it. Only the session owner edits their own list. These are read-only view links (citations earnings are already public), so **no ownership signature required** — but frame them as "wallets you're tracking," and note payouts still go to that wallet on-chain regardless.

## Part 3 — Aperture: aggregate in the dashboard
- New `aperture/src/lib/citations-summary.ts`: `fetchCitationsSummary(wallet): Promise<CitationsSummary | null>` → `fetch(`${CITATIONS_BASE_URL}/api/creators/${wallet}/summary`)`, parse, return null on any non-2xx/network error (never throw). `CITATIONS_BASE_URL` env, default `https://tollgate.gudman.xyz`. Type the response.
- `aperture/src/app/dashboard/page.tsx`: after loading the owner + Aperture works/earnings (existing), collect wallets = `[owner.wallet, ...(owner.linkedWallets ?? [])]` (lowercased, deduped), fetch each via `fetchCitationsSummary` in parallel, sum them.
- Render THREE sections, rebranded as **"Your Tollgate creator dashboard"**:
  1. **Photos (Aperture)** — existing works + earnings, unchanged.
  2. **Citations (cite-to-earn)** — combined sourceCount / citationCount / earnedAtomicUsdc across the wallets, and a list of the registered sources (title + earned). If all wallets return zero, show a prompt: "Register sources at tollgate.gudman.xyz, or add the wallet you use there below." Include the add/remove-wallet UI (Part 2) here.
  3. **Video** — a static card: short honest line that video payouts settle on-chain via the PeerTube plugin, with a link to the `/video` proof page. NOT a per-wallet number.
- A top summary strip may show a combined "total USDC earned across Tollgate" = Aperture earnings + Citations earnings (exclude video, since it's not quantified per wallet). Keep it honest — label it "Photos + Citations."
- If `fetchCitationsSummary` returns null (citations unreachable), the Citations section shows "couldn't load citations earnings right now" — the page must still render (no crash).

## Part 4 — Copy / nav
- Reframe the dashboard header from Aperture-specific to "Your Tollgate creator dashboard." Keep `SiteNav`/`SiteFooter`. No other pages change.

## Tests
- citations summary route: valid wallet with sources+receipts → correct aggregated numbers + `publicSource` projection (no `notifyEmail`/`walletId`); unknown wallet → zeros/empty 200; malformed wallet → 400; case-insensitivity (checksummed input matches lowercased-stored).
- aperture `citations-summary.ts`: 2xx → parsed; non-2xx/network error → null (no throw). (Stub `fetch`.)
- aperture `POST/DELETE /api/account/wallets`: session-gated (no session → 401), valid wallet added/lowercased/deduped/capped, malformed → 400.
- aperture dashboard: aggregates native + linked wallets (mock `fetchCitationsSummary`), sums correctly, renders when citations returns null, shows the video proof link (static), never leaks citations `notifyEmail`.

## Security invariants
- Citations summary endpoint returns only `publicSource` projection — no `notifyEmail`/`walletId`/`ownershipProof`.
- Aperture dashboard stays session-gated; wallet add/remove is session-owner-only.
- Cross-service fetch fails closed to a rendered "unavailable" state, never a crash and never a partial/leaky payload.
- No new dependency. No change to any payment/settlement/routing/gate logic — this is read-only aggregation + a linked-wallets list.

## Operator tasks (NOT Codex)
- Add `CITATIONS_BASE_URL=https://tollgate.gudman.xyz` to `/etc/aperture.env` (or rely on the default).
- Deploy BOTH apps: citations (`/opt/tollgate`) for the new summary endpoint, aperture (`/opt/aperture`) for the dashboard. Live-verify: as a creator whose Aperture account wallet (or a linked wallet) matches a real citations creator wallet (e.g. one of the live citations creators), the dashboard shows that wallet's citations sources + earnings alongside the Aperture photos; a creator with no citations activity sees the "add your wallet" prompt; video shows the proof link.

## Acceptance
- One logged-in dashboard shows Aperture photos + earnings AND Citations sources + earnings (joined by wallet, case-insensitive), plus a linked-wallets control and a video proof link.
- Citations earnings load via a read-only endpoint that leaks no PII; the dashboard degrades gracefully if it's unreachable.
- Video is an honest proof link, not a fabricated per-wallet number.
- `npm run typecheck && npm test && npm run build` green in BOTH apps. No new dependencies. No payment/settlement/gate changes.
