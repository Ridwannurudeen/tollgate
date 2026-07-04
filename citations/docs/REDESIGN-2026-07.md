# Tollgate Award-Grade Redesign — Design Spec (2026-07-04)

**Thesis: the receipt IS the brand.** Tollgate's product is proof-of-payment. The redesign
keeps the distinctive identity (archival paper + money-green + gold, Fraunces/Inter/Plex Mono
— derived from the 10-competitor teardown, WCAG-AA passed) and elevates it to award-grade
craft by systematizing the RECEIPT as the signature visual element, adding a motion system,
and fixing rhythm/hierarchy/disclosure defects. Explicitly REJECTED: dark glassmorphism reskin
(generic, erases identity, self-flagged contrast issues).

## A. Token upgrades (globals.css)
- Fluid type scale: display `clamp(2.9rem, 6vw, 4.4rem)` lh 1.08 ls -0.02em; h2 2rem; h3 1.375rem.
- Spacing rhythm: `--space-1..9` = 4/8/12/16/24/32/48/64/96; major sections separated by
  `--space-9`; panel padding standardized 32.
- Warm elevation scale: `--shadow-1/2/3` tinted `rgba(28,27,21,…)` never pure gray.
- Motion tokens: `--ease-spring: cubic-bezier(0.16,1,0.3,1)`, `--dur-1:150ms --dur-2:240ms
  --dur-3:420ms`. Everything animated wrapped in `@media (prefers-reduced-motion: no-preference)`.
- `--focus-ring`: 2px solid green offset 2px, on :focus-visible globally.
- `.num` utility: `font-variant-numeric: tabular-nums` for every amount/count.

## B. Signature receipt system
1. `.receipt-block` (evolves .evidence dark blocks): perforated top edge (radial-gradient
   punch-hole strip), warm dark bg, gold mono labels, cream values — used ONLY where hashes/
   payment evidence live. Light surfaces host everything else (fixes dark-monolith fatigue).
2. `.stamp`: rotated (-4deg) bordered uppercase mono badge ("PAID · ON-CHAIN") — used on the
   hero receipt, answer receipts, creator payout rows.
3. `.perf-rule`: perforation dotted divider between major page sections.
4. Hero stat card → a physical receipt artifact: itemized rows (payments / creators / USDC),
   perforated edges, slight -1.2deg rotation, stamp footer, shadow-2.

## C. Homepage restructure (LeptonWebApp.tsx)
- CTA hierarchy: exactly ONE filled green primary per view; form submit becomes primary green
  (kills the competing tan block); secondary = outline.
- Register form progressive disclosure: visible = Title, Link, Your name, Price, Wallet
  (optional, custodial hint). `<details class="form-advanced">` = handle, summary, topics,
  notification email, contributor splits. (99-guideline: progressive-disclosure, overwhelm.)
- Ticker: receipt-strip restyle, gradient fade edges, green amount emphasis, integrated pause.
- Who-got-paid rows: deterministic initial-avatar chip (hue from wallet bytes, pure CSS),
  hover lift, tabular amounts, top-3 subtle rank marks.
- Step cards: inline stroke SVG icons (register/cite/withdraw) replacing bare number circles;
  numbers stay as small mono index. One icon set, 1.75 stroke.
- Entrance choreography: hero elements stagger in (opacity + 8px rise, dur-3, 60ms steps);
  cards hover-lift translateY(-2px)+shadow-2; buttons press scale(0.98).

## D. Deep pages (proof/core/demo/answers/receipts/sources/creators)
- Break dark monoliths: numeric summaries → light stat tiles (big tabular numerals, mono
  labels); ONLY hash rows stay in receipt-blocks. Alternate light/dark rhythm down the page.
- ALL USDC amounts through formatDollars (kills `0.081000` artifacts); negative internal
  metrics (protocol retained) rendered as styled `−$x` with explanatory hint, never raw.
- Long pages get a sticky mini-anchor-nav (proof, core).
- Long hashes: middle-truncate with copy-on-click affordance, full value in title attr.

## E. Non-negotiable guardrails
- No new fonts, no new palette hues (existing tokens only), no framework/library additions,
  no emoji icons (inline SVG only), AA contrast preserved (re-verify gold/green on paper),
  all tests + typecheck + build green, class surface backward compatible where pages share
  CSS (aperture pages consume some shared classes — verify before renaming/removing any class).
- Every page screenshot-verified at 1512 AND 375 wide before commit.

## Status
- [x] Phase 1: tokens + motion + receipt system (globals.css)
- [x] Phase 2: homepage restructure
- [x] Phase 3: proof + core + demo (dark monoliths broken up, formatDollars everywhere, receipt stamps)
- [x] Phase 4: receipt system cascades via shared signature-stat/receipt-context classes (verified)
- [x] Phase 5: mobile guards (overflow-x clip, creator-row row layout, grid min-width 0); NOTE headless-new Chrome min-window ~500px crops narrower screenshots - 500px view verified pixel-perfect, real-device 375 untested
