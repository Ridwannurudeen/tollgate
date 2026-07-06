# Codex scope — ground answers in real fetched page content (not creator metadata)

Today the "Ask the AI" agent grounds its answer ONLY in `paidExcerpt`, which `source-content.ts:44-52` builds from the creator's registration **metadata** (title + summary + tags + URL) — NOT the actual article text. So answers are thin and often say "not documented in the purchased sources." The registration fetch (`catalog.ts registrationContentEvidence`) already downloads the real page (SSRF-safe, content-type-gated, 200KB cap) but **only hashes it and throws the text away**. This change stores the extracted text and grounds answers on it.

All paths relative to `citations/`. Read every file before editing. Match existing style. Run `npm run typecheck && npm test && npm run build` before finishing. Do NOT change the x402/settlement/ledger-integrity code or the contracts.

## Design (registration-time fetch, stored on the source — no per-query latency)
Fetch + extract at registration (the fetch already happens there), store a capped readable-text excerpt on the source record, and prefer it over the creator summary when drafting. Existing sources are backfilled by a script.

## 1. `src/lib/types.ts`
Add `contentExcerpt?: string;` to `CreatorSource` (near `contentHash?`/`contentFetchedAt?`, line ~54). Optional — seed/unfetched sources won't have it.

## 2. `src/lib/catalog.ts` — extract + store real text
`registrationContentEvidence` (line 549) currently returns `Pick<CreatorSource, "contentHash" | "contentFetchedAt">` and discards `text`. Change it to also return `contentExcerpt`:
- Keep everything (safeFetch, content-type gate, timeout, `contentHash = sha256Hex({url, body: text.slice(0,200_000)})` — the integrity hash of the full body stays as-is).
- Add a small module-level `htmlToText(html: string): string` helper (no new dep — hand-rolled): remove `<script …>…</script>` and `<style …>…</style>` blocks, strip all remaining tags, decode the common entities (`&amp; &lt; &gt; &quot; &#39; &nbsp;`), collapse whitespace runs to single spaces, trim.
- Set `contentExcerpt = htmlToText(text).slice(0, 2000)` (cap at 2000 chars to bound prompt/storage). If the extraction is empty/whitespace, omit it (return no `contentExcerpt`).
- Return `{ contentHash, contentFetchedAt, contentExcerpt }`. The merge at `appendSource` line 635 (`...contentEvidence`) persists it automatically — no other catalog change needed.
- Update the return type annotation to include `"contentExcerpt"`.

Note: RSS/Atom/XML feeds are also allowed by the content-type gate — `htmlToText` on them yields the text nodes, which is fine.

## 3. `src/lib/source-content.ts` — ground on real content
In `buildSourceContent` (line 33), when `source.contentExcerpt` is present and non-empty, use it as the excerpt the agent reads; otherwise fall back to `source.summary` (seed sources, or fetch-failed). Concretely, change the `Excerpt:` line of `paidExcerpt`:
```
`Excerpt: ${source.contentExcerpt?.trim() ? source.contentExcerpt.trim() : source.summary}`,
```
Keep the other lines (sourceKindLabel, Title, Tags, Canonical URL) unchanged. `previewExcerpt` stays from `source.summary` (it's the short public teaser). The `contentHash`/`excerptHash` over `paidExcerpt` recompute automatically — that's correct and forward-safe (ledger integrity never recomputes historical receipt hashes; old receipts unaffected).

## 4. Backfill script — populate existing sources
New `scripts/refetch-source-content.mjs` (+ `package.json` script `"refetch:content": "node scripts/refetch-source-content.mjs"`). It:
- Reads the custom source registry (the same file `readCustomSources` uses — `data/sources.json`; reuse `scripts/ledger-store.mjs`-style helpers or read the JSON directly).
- For each source with a real `http(s)` URL and `sourceKind !== "seed"` that lacks `contentExcerpt` (or pass `--all` to refresh every one): fetch via the SAME safe path + `htmlToText` extraction (import/share the helper — do NOT duplicate the SSRF logic; if `registrationContentEvidence`'s internals aren't exportable, export a small `fetchSourceContentExcerpt(url)` from catalog.ts and use it in BOTH places so there's one implementation).
- Writes `contentExcerpt` + refreshed `contentHash`/`contentFetchedAt` back to the registry (respect the same write path/lock).
- Logs how many were updated/skipped/failed. Idempotent.
This runs on the VPS so the ~15 live external sources immediately ground on real content.

## 5. Tests
- `source-content.test.ts` (or wherever buildSourceContent is tested): (a) with `contentExcerpt` set → `paidExcerpt` contains the real content, not the summary; (b) without it → falls back to `summary`.
- `catalog.test.ts`: `registrationContentEvidence`/`fetchSourceContentExcerpt` with a mocked `safeFetch` returning HTML → asserts tags stripped, entities decoded, capped at 2000, and that non-HTML content-type returns no excerpt (existing behavior preserved).

## Risks / notes (call out, don't silently ignore)
- **Prompt injection:** a malicious source page could embed "ignore previous instructions"-style text. This is inherent to RAG. Current mitigations (content is clearly framed as source data; the self-critique step only keeps claims tied to a purchased `sourceId`) blunt it, but note it. Do NOT add elaborate sanitization now — just keep the excerpt as plain delimited data.
- **JS-rendered SPAs** yield little text → those sources fall back to summary (acceptable).
- `TOLLGATE_REGISTRATION_FETCH` already defaults ON (`!== "0"`) so new registrations fetch; this just stops discarding the text.

## Acceptance
- A newly-registered source with a real article URL produces a `paidExcerpt` containing the page's actual text; `buildSourceContent` falls back to `summary` when `contentExcerpt` is absent.
- `refetch:content` backfills existing external sources; after running it on the VPS, a live `/api/query` whose bought source has real content produces a substantively richer, source-grounded answer (spot-check that answers stop saying "not documented in the purchased sources" for well-covered questions).
- Seed sources unchanged (still summary-grounded).
- One shared SSRF-safe fetch+extract implementation (no duplicated fetch logic).
- `npm run typecheck && npm test && npm run build` green. No settlement/contract changes.
