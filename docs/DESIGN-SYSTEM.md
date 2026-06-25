# Tollgate — Design System

> Rebuilt 2026-06-25 from a source-level teardown of 10 competitor sites (see `COMPETITIVE-LANDSCAPE.md`). Theme: **"archival paper + money-green + gold proof."** Implemented in `src/app/globals.css` (cascades to every page) + fonts loaded in `src/app/layout.tsx`.

## What was distilled from the 10 competitors

| Principle | Source(s) observed | How Tollgate applies it |
|---|---|---|
| Warm paper ground, not dark-SaaS-neon | ProRata `#F7FCF0`, Numbers `#f4e9d5`, Data Foundation `#f8f8f6` | `--bg #efe8d8` / `--paper #f6f2e7` warm cream |
| Two-tier type = trust: editorial serif + ONE monospace for every verifiable string | ProRata (PP Editorial + GT Mono), ScalePost (Inter + IBM Plex Mono), Numbers (Instrument Serif + Roboto Mono) | Fraunces (display) + Inter (body) + IBM Plex Mono (all hashes/tx/USDC/IDs) |
| One saturated accent + metallic gold for "value" | Numbers gold `#d8b76a`, Data Foundation gold `#ac8549` | `--green` primary + `--gold` accent (budget/market) |
| Render the artifact, don't describe it | Cloudflare HTTP-402 hero block | headline money stat is a dark "artifact" card (`--ink-block`) with the figure in mono |
| Single-hue alpha ladder for cohesion | ScalePost `--signal` at ~15 opacities | green/gold expressed as tints, borders, glows |
| Pill CTAs, generous whitespace, hairline rules | Created by Humans, TollBit | 999px buttons, `--line` hairlines, sectioned panels |

## Tokens (in `globals.css :root`)

- **Paper:** `--bg #efe8d8` · `--paper #f6f2e7` · `--paper-raised #fdfaf0` · `--paper-sunken #e6dfcd`
- **Ink:** `--ink-1 #1c1b15` → `--ink-4 #9a937f` (warm near-black to faint)
- **Brand:** `--green #1e6a47` (primary/money/trust) · `--green-bright #2f9e6b` · `--gold #a87c2e` (value) · `--alert #b8472f`
- **Artifact block:** `--ink-block #16150f` (dark money-stat / proof surfaces) · `--ink-block-ink #efe9d6`
- **Type:** `--font-display` Fraunces · `--font-ui` Inter · `--font-num` IBM Plex Mono
- **Radius:** 4 / 7 / 10 / 14px · **Shadow:** warm low `rgba(43,36,18,.10)`
- Back-compat aliases kept (`--mint`→green, `--copper`→gold, `--surface*`→paper) so no rule/inline ref breaks.

## Rules of use

1. **Monospace = proof.** Every hash, tx, USDC amount, citation ID, wallet, and metric uses `--font-num` with `font-variant-numeric: tabular-nums`. Narrative/headlines use Fraunces; body uses Inter.
2. **Green = money flowing.** Reader-payment cards, claimable balances, positive numerics, primary CTAs.
3. **Gold = the market/budget.** Source decision board, source-register CTA, the "unit" on the headline stat.
4. **Dark artifact card** (`.signature-stat`, `.proof-stat`) is the one inverted surface — reserve it for the headline figure so it reads as "the receipt."

## Fonts

Loaded via `<link>` to Google Fonts in `layout.tsx` (NOT `next/font/google`, because the build sandbox can't reach `fonts.gstatic.com` — the browser fetches them at runtime instead). Families: Fraunces (ital, optical 9..144, 300..600), IBM Plex Mono (400/500/600), Inter (400–700).

## Verify

`npm run typecheck` · `npm run build` · `npm run dev` then open the homepage, `/core`, `/proof`, `/demo`, `/answers/<id>`, `/creators/<wallet>` — all share `globals.css`, so the system is consistent across them. 40 unit tests unaffected (lib-only).
