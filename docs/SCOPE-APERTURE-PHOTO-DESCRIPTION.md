# Codex scope — photo description field (shown on browse + gated link page)

Today a registered photo has only a `title` — buyers on `/browse` and the gated `/link/[id]` page can't read what the photo is about. Add an optional **description** the photographer writes at registration, displayed under the title on both the public browse grid and the gated link page.

All in `aperture/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build`. Do NOT touch payment/x402/download/fee-router/license-gate/nginx/preview/citations-summary code.

## Verified current shape
- `src/lib/link-registry.ts`: `LinkRecord` has `title`, no description. `PublicLinkRecord = Omit<LinkRecord, "sourceUrl" | "sourceContentHash">` — so a new field on `LinkRecord` is automatically exposed publicly (safe: description is meant to be public). `RegisterLinkInput`, `registerLink`, `publicLink`, and the `isLinkRecord` validator all live here.
- `src/lib/link-registration.ts`: validates `title` via `stringField(input.title, "title", MAX_TITLE_LENGTH)`; registration input type has `title?: unknown`. Mirror this for description.
- `src/components/LinkRegistrationForm.tsx`: the registration form (title/name/wallet/email inputs).
- `src/app/browse/page.tsx`: renders each link's title + photographer.
- `src/app/link/[id]/page.tsx`: renders title + price + preview.

## Build
1. **`link-registry.ts`**
   - Add `description?: string` to `LinkRecord` and `RegisterLinkInput`.
   - `registerLink`: persist `description` when present (mirror the existing `...(input.hasPreview ? ...)` conditional-spread style; store trimmed).
   - `publicLink`: include `description` when present (same conditional-spread pattern).
   - `isLinkRecord`: accept `description === undefined || typeof description === "string"`.
2. **`link-registration.ts`**
   - Add `description?: unknown` to `LinkRegistrationInput`.
   - Add `const MAX_DESCRIPTION_LENGTH = 600;`. Add an `optionalDescription(value)` helper: undefined/empty → undefined; if a non-string → throw `LinkRegistryError("description must be a string.")`; trim; if longer than max → throw `LinkRegistryError("description is too long.")`; else return trimmed. (Description is OPTIONAL — unlike title.)
   - Pass `description` into the `registerLink(...)` call.
3. **`LinkRegistrationForm.tsx`**
   - Add an optional `<textarea>` "Description" field (label it optional), 3–4 rows, sending `description: description.trim() || undefined` in the POST body. Include the returned/registered description in the success card if convenient (optional).
4. **`browse/page.tsx`**
   - Under each card's title, render `link.description` when present (truncate/clamp with CSS to ~2–3 lines so cards stay uniform; add a minimal `.browseDesc` rule in `globals.css` if needed — match the paper theme).
5. **`link/[id]/page.tsx`**
   - Render the full `link.description` under the title (no truncation on the detail page), styled to match. If absent, render nothing (no empty element).

## Tests
- `link-registry.test.ts`: `registerLink` persists a description; `publicLink` includes it; `isLinkRecord` accepts string/undefined and rejects a non-string description.
- `link-registration.test.ts`: registration with a valid description stores it (trimmed); over-length → 400-style `LinkRegistryError`; non-string → error; omitted → registers fine with no description.
- browse/link pages: render the description when present; render cleanly when absent (no empty node).

## Security / invariants
- Description is user text rendered in React (auto-escaped) — do NOT use `dangerouslyInnerHTML`. Plain text only.
- No change to `sourceUrl` handling; description is public by design (it's Omit-exposed already).
- No new dependency.

## Acceptance
- A photographer can add an optional description at registration; it shows under the title on `/browse` (clamped) and in full on `/link/[id]`.
- Omitting it still works. Over-length is rejected with a clear message.
- `npm run typecheck && npm test && npm run build` green. No payment/gate/preview changes. No new dependency.
