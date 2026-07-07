# Codex scope — direct photo upload (alternative to paste-a-link)

Today the only way to list a photo is pasting a public URL (`sourceUrl`); non-technical creators have no hosted URL. Add a **direct file upload** option: the creator uploads an image, we store the original, gate it behind the same x402 payment, and serve it to buyers after they pay. The buyer-facing contract is UNCHANGED (they always receive proxied bytes, never a URL).

**Model shift (intended):** the URL path never stores the original — it re-fetches `sourceUrl` on each download. The upload path MUST store the original on disk (`data/originals/`) and serve from there. This is the correct stock-photo model; call it out but don't avoid it.

All in `aperture/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build`. Do NOT change the x402 settlement / receipt / ledger logic itself — reuse it. Do NOT touch nginx/citations-summary.

## Verified architecture (reuse these)
- `src/lib/link-download.ts` `handleLinkDownload` is the real paid path: 402 without `X-PAYMENT-SIGNATURE`, else `settleX402` → append receipt → serve bytes. It currently hardcodes `probeImageSource(link.sourceUrl)` + `fetchImageBytes(link.sourceUrl)` (the only URL coupling on the download path). The buyer only ever gets proxied bytes; `sourceUrl` is omitted from `PublicLinkRecord`.
- `src/lib/link-preview.ts` `buildWatermarkedPreview(bytes: Uint8Array)` takes raw bytes and (via sharp) throws on non-image — reuse directly for uploads; `writeLinkPreview(id, bytes)` uses an atomic tmp+rename pattern.
- `src/lib/link-registry.ts`: `LinkRecord`, `registerLink`, `publicLink` (omits sourceUrl/sourceContentHash), `isLinkRecord`, `findLinkBySourceUrl`. Atomic write pattern here too.
- `src/lib/onboarding.ts` `registerCreator`, `src/lib/account.ts` `getSessionOwner` — reuse for owner attach (logged-in upload reuses the session account, like the JSON path).
- `LINK_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024` (`link-content.ts`) — reuse as the upload size cap.
- **No multipart handling and no magic-byte validator exist today** — both are new.
- Deploy preserves `data/` (tar `--exclude=data`, extract-over never deletes) — verified with previews; `data/originals/` will persist the same way.

## Build

### 1. Record shape (`link-registry.ts` / `types` as needed)
- Add `sourceKind?: "url" | "upload"` to `LinkRecord` + `RegisterLinkInput` (absent/`"url"` = today's behavior, fully back-compat).
- Make `sourceUrl` optional on `LinkRecord`/`RegisterLinkInput` (uploads have none). `publicLink` already omits it. Add `originalContentType?: string` (the sharp-detected type, used to serve the download with correct `content-type`/extension).
- `isLinkRecord`: accept `sourceKind` in `{undefined,"url","upload"}`, `sourceUrl` optional, `originalContentType` optional string.
- `registerLink`: when `sourceKind === "upload"`, skip URL http/https normalization and the `findLinkBySourceUrl` URL-uniqueness; instead dedupe by `sourceContentHash` if you want (optional — else allow dups). Persist `sourceKind`, `originalContentType`, `sourceContentHash`, no `sourceUrl`.

### 2. Originals store — `src/lib/link-originals.ts` (new)
- `writeLinkOriginal(id, bytes, ext)`: mkdir `data/originals`, atomic tmp+rename to `data/originals/<id>.<ext>` (mirror `writeLinkPreview`). Path derived only from the validated link id — never raw input (traversal-safe; reuse the `previewPath` guard style).
- `readLinkOriginal(id, ext)`: read + return `Uint8Array`.
- Store `ext` derived from the sharp-detected format (Part 3), not the client filename.

### 3. Upload route — `POST /aperture/api/links/upload/route.ts` (new, runtime nodejs)
- Parse `request.formData()`. Fields: `file` (the image), `title`, `displayName`, `description?`, `wallet?`, `email?` (same semantics as `/api/links`).
- **Size cap:** reject if the file is larger than `LINK_DOWNLOAD_MAX_BYTES` (check `file.size`, and defensively the buffer length) → 413/400 with a clear message.
- **Validate it's a real image via sharp:** read bytes → `sharp(bytes).metadata()`; if it throws or format isn't a supported raster type (jpeg/png/webp/gif/avif/tiff) → 400 "file is not a supported image." Derive `originalContentType` + `ext` from sharp's detected `format`, NOT from the client-supplied filename/content-type (do not trust client metadata).
- Compute `sourceContentHash` from the bytes (reuse the existing hashing util used for links; if it's internal, add a small `sha256` over the bytes consistent with the codebase).
- Resolve session owner (`getSessionOwner`) → reuse existing account when logged in, else `registerCreator` (mints custodial wallet) + issue account key, exactly like the JSON path.
- `buildWatermarkedPreview(bytes)` → `writeLinkPreview(id, preview.bytes)`; `writeLinkOriginal(id, bytes, ext)`; `registerLink({ sourceKind: "upload", title, description, ownerId, originalContentType, sourceContentHash, hasPreview: true })`.
- Return the SAME result shape as `/api/links` (publicLink + registered + shareUrl + accountKey when a new account). Set the session cookie for a new account (same as JSON path).
- Reuse the existing registration rate-limiter.
- On any failure after partial writes, don't leave a half-registered link (register only after original+preview are written).

### 4. Download branch (`link-download.ts` `handleLinkDownload`)
- After settlement, branch: if `link.sourceKind === "upload"` → `readLinkOriginal(link.id, ext-from-originalContentType)` and serve those bytes with `content-type: link.originalContentType` + `content-disposition: attachment`. Else the existing `fetchImageBytes(link.sourceUrl)` path. Same 402 gate, same receipt append, same proxy-serve — ONLY the byte source differs.
- The pre-payment `probeImageSource(sourceUrl)` reachability check is URL-only; for uploads, instead verify the stored original exists (readable) and 502/410 if missing.

### 5. Form UI (`LinkRegistrationForm.tsx`)
- Add a mode toggle: **"Upload a file"** vs **"Paste a link."**
- Upload mode: `<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif,image/tiff">`. On submit, build `FormData` (file + title + description + displayName + wallet + email) and POST to `/api/links/upload` (multipart — do NOT set JSON content-type; let the browser set the multipart boundary).
- Link mode: unchanged (existing JSON POST to `/api/links`).
- Show the same success card (share link + watermarked preview + account key).

## Tests
- upload route: valid image → registers an `upload` link, writes original + preview, returns shareUrl (mock the writers + registerCreator via a DI seam or a temp data dir); non-image bytes → 400; over-cap → rejected; logged-in upload reuses the session owner (no new wallet); logged-out upload creates an account + returns accountKey.
- `link-originals.ts`: write→read round-trip; path-traversal attempt via a crafted id is rejected/derived-only.
- download: an `upload` link serves the stored original bytes with the stored content-type after settlement; a `url` link still proxies `sourceUrl`; buyer response never contains `sourceUrl`.
- registry: `isLinkRecord` accepts upload records (no sourceUrl); `publicLink` never exposes `sourceUrl`/`sourceContentHash`/original path for either kind.

## Security invariants
- Validate images by decoding (sharp), not by trusting client content-type/filename; derive type+extension from sharp.
- Enforce the 25 MB cap before doing heavy work.
- Original file path derived solely from the validated link id (uuid) — no user input in the filesystem path.
- Uploaded originals are served ONLY through the paid `handleLinkDownload` gate (same x402 as URL links) — never a public route; the preview route still serves only the watermarked webp.
- No `sourceUrl`/original-path/hash leakage in any public projection.
- No new dependency beyond `sharp` (already present).

## Operator tasks (NOT Codex)
- Add `data/originals/` to `aperture/.gitignore` (like `data/previews/`) so uploaded originals aren't committed and persist server-side.
- Deploy: originals live under `/opt/aperture/data/originals/` and survive redeploys (`--exclude=data`); ensure the VPS has disk headroom (up to 25 MB/photo).
- Live-verify: upload a real image (logged out) → account created, watermarked preview on browse + gated page → pay via the demo unlock → receive the original bytes; confirm the source is stored, not re-fetched.

## Acceptance
- A creator can list a photo by uploading a file (no URL needed); it gets a watermarked preview and a gated page exactly like URL links.
- After payment, the buyer receives the stored original with the correct content-type; `sourceUrl`/URL links still work unchanged.
- Uploaded originals are only reachable through the paid gate; no path traversal; non-images and oversized files are rejected.
- `npm run typecheck && npm test && npm run build` green. No new dependency. x402/settlement/receipt logic unchanged.
