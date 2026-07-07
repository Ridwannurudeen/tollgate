# Codex scope — reskin Aperture to the main-site design system

Goal: make the Aperture app (`aperture/`, served at `/aperture`) visually match the citations main site's **"archival paper + money-green + gold proof"** theme. Today Aperture is a dark, system-font (Arial/Courier New) app that looks off-brand next to the polished main site; a judge clicking from the main site into `/aperture` sees a jarring, lower-quality page. This must feel like one product.

**Good news (verified):** Aperture styling is 100% class-driven — there are **no inline `style={{}}` and no hardcoded hex/rgb colors in any `.tsx`**. So this is almost entirely: (a) rewrite `aperture/src/app/globals.css`, (b) add fonts to `aperture/src/app/layout.tsx`, (c) recolor `aperture/src/app/icon.svg`. **Do NOT change component JSX or class names** — keep the class surface identical so markup is untouched.

Read every file before editing. Match the citations look precisely (recipes below). Run in `aperture/`: `npm run typecheck && npm test && npm run build`. Do NOT touch aperture's logic, API routes, or data — visual only.

The source of truth for the target look is `citations/src/app/globals.css` + `citations/src/app/layout.tsx` — open them and mirror their treatments.

---

## 1. Fonts — `aperture/src/app/layout.tsx`
It currently loads NO web fonts. Add to `<head>` (verbatim from citations layout):
```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
```
(Match how citations layout injects them — plain `<link>` in the returned JSX head, NOT next/font.)

## 2. `aperture/src/app/globals.css` — full restyle

### 2a. Replace the `:root` token block
Swap aperture's dark tokens for the citations palette. Paste the citations `:root` block (copy it from `citations/src/app/globals.css` verbatim — paper/ink/green/gold/ink-block colors, shadows, radii, spacing, motion, and the three font vars `--font-display: "Fraunces"…`, `--font-ui: "Inter"…`, `--font-num: "IBM Plex Mono"…`). Keep any aperture-only tokens it still needs (e.g. `--bad`/alert) mapped to the citations `--alert: #b8472f`.

**⚠ Font-var gotcha:** aperture currently sets `body { font-family: var(--font-display) }` and `--font-display: Arial`. In the citations system, **body = `--font-ui` (Inter)** and **headings = `--font-display` (Fraunces)**. So you must also fix the `body` rule to use `--font-ui`, and ensure `h1/h2/h3` use `--font-display`. Don't just swap token values — the body currently points at the display var.

### 2b. Base / body
Mirror citations base: `html, body { background: var(--bg); color: var(--ink-1); }`, `body { font-family: var(--font-ui); line-height: 1.6; -webkit-font-smoothing: antialiased; }`, `* { box-sizing: border-box }`, `a { color: var(--green) }`, `:focus-visible` green ring, `overflow-x: clip`. Replace the two `body::before` / `body::after` overlays with the **light** citations versions (faint warm dot-grid `radial-gradient(rgba(76,64,30,0.07) 1px, transparent 1px)` 30px grid + soft green/gold top-glow) — the current ones are tuned for a dark canvas and will read wrong on paper.

### 2c. Restyle every class to the citations look
Keep each selector name; change its rules. Apply these citations recipes (pull exact values from `citations/src/app/globals.css`):

| Aperture class | Restyle to match citations |
|---|---|
| `.shell`, `.compact` | container: `width: min(1200px, calc(100% - 32px)); margin: 0 auto`, `position: relative; z-index: 1` (sit above the body overlays) |
| `.topbar`, `.brand`, `.navlinks` | the `.site-nav` / `.nav-brand` frosted-paper sticky nav: `background: rgba(243,237,224,0.92); backdrop-filter: blur(14px); border-bottom: 1px solid rgba(204,194,169,0.76)`. Brand name in Fraunces, sub-text mono uppercase. Navlinks mono, `color: var(--ink-3)`, hover `--green`. |
| `.hero`, `.lede`, `.pageHeader`, `.pageHeader h1`, `.pageHeader p` | hero heading = Fraunces huge (`clamp(52px,8.4vw,112px)` for the landing h-level, else the `h1` recipe), `.lede`/`.pageHeader p` = `--ink-2`, 16px, Inter (replace the hardcoded `#c7ced8`). |
| `.eyebrow` | citations `.eyebrow`: mono 10px, `letter-spacing:.16em`, uppercase, `color: var(--green)` (gold-bright on dark blocks). |
| `.actions`, `.button`, `.button:hover`, `.primary`, `.button:disabled` | `.button` → citations `.secondary-button`/`.cta-secondary` (paper, line-strong border, mono uppercase, hover green tint + translateY(-1px)); `.primary` → `.primary-button`/`.cta-primary` (green bg `var(--green)`, text `#f6f2e7`, hover `--green-deep`). Replace `#07100c` text with `#f6f2e7`. |
| `.heroPanel`, `.tableSurface`, `.flowCard`, `.surface`, `.operatorBand`, `.twoColumn` children | paper cards: `background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--radius-lg); box-shadow: 0 1px 2px var(--shadow), 0 16px 44px var(--shadow)`. Replace the `rgba(18,22,29,…)` dark panel literals. |
| `.statStrip`, `.statStrip > div`, `.metricGrid`, `.metricGrid div/span`, `.panelLabel` | citations `.metric` / `.receipt-grid` cells: hairline-separated (`gap:1px; background: var(--line)`), `--paper-raised` cells, mono uppercase 10px labels in `--ink-4`, mono tabular-nums values in `--ink-1`. |
| `.bigNumber` | the headline stat — render as the citations **dark receipt** `.signature-stat` treatment IF it's the hero money number (ink-block bg, `#fdfaf0` big mono number, gold-bright unit), OR at minimum big mono tabular-nums in `--ink-1`. Prefer the signature-stat artifact for the hero stat to carry the brand. |
| `.liveRow`, `.liveDot` | green live dot (`background: var(--green-bright)`, soft green ring), mono label. |
| `.flow`, `.flowCard span/h2/p` | citations `.step-card` (paper card, green numbered `span` badge, Fraunces `h2`/h3, `--ink-2` body). |
| `.proofHeader`, `.proofHeader h1`, `.status`, `.pill`, `.status.ok`, `.status.bad` | `.pill`/`.status` → citations `.network-pill` / `.source-badge` (pill, paper-raised, mono). `.ok` = green-tinted badge (`rgba(30,106,71,.24)` border, `--green-deep` text); `.bad` = alert-tinted. Replace green/red rgba literals with token-based. |
| `.sectionTitle`, `.sectionTitle h2/span` | Fraunces h2, mono eyebrow span. |
| `.row`, `.receiptRow`, `.row:last-child`, `.row strong`, `.num`, `.muted`, `.empty` | ledger rows: `border-bottom: 1px solid var(--line)` (replace dark line literal), `.num` mono tabular-nums (amounts in `--green` or `--gold` per citations `.numeric-cell`/`.source-card strong`), `.muted` = `--ink-3`. |
| `.operatorGrid`, `.operatorGrid a/span` | link cells on paper; links `--green`, mono labels. |
| `.commandBlock`, `.steps code` | KEEP these DARK — a dark code block on light paper is on-brand (mirror citations' ink-block treatment): `background: var(--ink-block); color: var(--ink-block-ink); font-family: var(--font-num)`. This is intentional contrast, not the old dark theme. |
| `.registerForm`, `label`, `.registerForm input`, `input:focus`, `.hint`, `button`, `button:disabled`, `.formStatus` | citations form inputs: `label` mono uppercase `--ink-3`; `input` mono, `background: var(--paper)`, `border: 1px solid var(--line-strong)`, `color: var(--ink-1)`, focus green ring `box-shadow: 0 0 0 3px rgba(30,106,71,.12)` (replace the dark `#0a0d11` input bg — this is the most visibly-wrong element on light theme); form button = `.primary-button` green; `.hint`/`.formStatus` = `--ink-4`/`--ink-3`. |
| `.steps`, `.compactRows`, `.ownerRow`, `.inlineTitle`, `.downloadAction`, `.statusText`, `.badText` | paper surfaces / mono text; `.badText` = `--alert`; `.statusText` = `--ink-3`. |
| `h1, h2, h3, small, a` bare elements | citations heading recipes (Fraunces, weights 480–520, tight `clamp()` sizing, negative letter-spacing). |

Eliminate EVERY hardcoded color the dark theme used (these are in globals.css, not vars): `#c7ced8`, `#07100c`, `rgba(18,22,29,…)`, `rgba(35,209,139,…)`, `#0a0d11`, `#dfe7ef`, `#8a93a0`, `rgba(37,45,56,…)`, `rgba(255,104,120,…)`, `#c7ced8`. Replace each with the corresponding citations token. Grep the finished file for `#0a0d11|#12161d|#0b0d10|23d18b|c7ced8|dfe7ef` → must be zero.

## 3. `aperture/src/app/icon.svg`
Recolor from the dark theme: the `<rect fill="#0b0d10">` dark background → warm paper `#f6f2e7` (or transparent); keep the aperture ring but use `--green` `#1e6a47` and center `--gold` `#866324` so the favicon matches the brand. Verify it still reads at 32px.

## Acceptance
- `/aperture`, `/aperture/proof`, `/aperture/onboarding`, `/aperture/install`, `/aperture/download` all render on warm paper with Fraunces headings, Inter body, IBM Plex Mono for labels/numbers — visually consistent with the main site.
- No dark-theme remnants: grep of `aperture/src/app/globals.css` for the old hexes (`#0b0d10 #12161d #0a0d11 #23d18b #c7ced8 #dfe7ef`) returns nothing; the register form input is light, not dark.
- Component JSX and class names unchanged (visual-only diff in globals.css + layout.tsx + icon.svg).
- Fonts load (view source shows the fonts.googleapis link).
- `aperture/` `npm run typecheck && npm test && npm run build` all green.
- Deploy note (for whoever ships it): Aperture deploys separately to `/opt/aperture` via `aperture.service` (NOT /opt/tollgate) — tarball the `aperture/` subtree, `--exclude=data`, rebuild, `systemctl restart aperture.service`.
