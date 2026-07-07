# Codex scope — watermarked low-res preview on the gated photo page

Today a buyer on `/aperture/link/[id]` sees ONLY a title, photographer name, and price — no image at all (confirmed: `src/app/link/[id]/page.tsx` has no `<img>`). Nobody pays for a photo they can't see. Fix it the industry-standard way (Shutterstock/Getty): show a small, **watermarked, downscaled** preview publicly; keep the full-resolution original hidden behind payment exactly as today.

All in `aperture/`. Read every file before editing. Run `npm run typecheck && npm test && npm run build` in `aperture/`. Do NOT touch the download/payment routes, x402, fee-router, the Immich license gate, or nginx.

## Verified reuse points
- `src/lib/link-content.ts` `fetchImageBytes(url, options)` already downloads the full image SSRF-safely, capped at `LINK_DOWNLOAD_MAX_BYTES` (25 MB), image-content-type enforced. Use it to get pixels for the preview — do NOT write a new fetch.
- `src/lib/link-registration.ts` `handleLinkRegistration` currently only PROBES (64 KB range request via `probeImageSource`) — it does NOT download the full image. You will add a preview-generation step here that DOES fetch full bytes once (via `fetchImageBytes`) to build the preview. This makes registration slightly slower (one full image download) — acceptable, it's a one-time cost.
- `src/lib/link-registry.ts` `LinkRecord` / `RegisterLinkInput` / `registerLink` — the record store (atomic write + lock pattern). `PublicLinkRecord` = `Omit<LinkRecord, "sourceUrl" | "sourceContentHash">` (the projection the page/API get — sourceUrl stays hidden).
- Data dir is `data/` (deploys `--exclude=data`, so generated files persist and are server-generated, like the ledger).

## Dependency
Add `sharp` (standard Node image lib; native binaries, works on the Linux VPS node 23 and local node 24). Add to `package.json` dependencies (NOT dev — it runs at registration in the server runtime). Operator will `npm ci` on deploy.

## Build

### 1. Preview generation — `src/lib/link-preview.ts` (new)
`export async function buildWatermarkedPreview(imageBytes: Uint8Array): Promise<{ bytes: Uint8Array; contentType: "image/webp" }>`:
- Use sharp: **downscale hard** to max 600px on the longest edge (`resize(600, 600, { fit: "inside", withoutEnlargement: true })`), then composite a repeating/centered watermark, then encode webp at modest quality (`.webp({ quality: 55 })`). The result MUST be visibly a preview, not a usable substitute for the paid original — small + watermarked + lossy is the point.
- Watermark: build an SVG text overlay ("TOLLGATE · PAY TO UNLOCK" or similar, semi-transparent, tiled or a large diagonal centered band) sized to the resized image, composite it over. Keep it legible but not destroying the ability to judge the photo.
- Handle failure: if sharp throws (corrupt/unsupported bytes), throw a clear error the caller can catch — do NOT return the original bytes as a "preview" (that would leak the full image). A registration whose preview fails should either fail cleanly OR register with no preview (decide: prefer register-with-no-preview so a valid image with a quirky format still works — see #2).
- Unit test with a tiny generated test image (sharp can create one: `sharp({create:{...}}).png().toBuffer()`), assert output is webp, is smaller, and dimensions ≤ 600.

### 2. Store the preview at registration — `handleLinkRegistration` + registry
- After the existing probe/dedup/registerCreator steps, fetch full bytes with `fetchImageBytes(url)`, call `buildWatermarkedPreview`, and write the preview bytes to disk at `data/previews/<link.id>.webp` (create the dir if missing; mirror the atomic-write style used elsewhere). If preview generation fails, log and continue registration WITHOUT a preview (the page falls back to no-image, same as today) — never block registration or leak original bytes.
- Add to `LinkRecord` (and `PublicLinkRecord` since the page needs it): `hasPreview?: boolean`. Set it true only when the preview file was written. Keep `sourceUrl` OUT of the public projection (unchanged).
- Storage note: previews are keyed by link id; the file path is derived, not stored, so no path is ever exposed.

### 3. Serve the preview — `GET /aperture/link/[id]/preview` (new route, runtime nodejs)
- Look up the link; if missing or `hasPreview` is false → 404.
- Read `data/previews/<id>.webp`, return it with `content-type: image/webp` and a sane `cache-control` (e.g. `public, max-age=3600` — previews are immutable per link). This route is PUBLIC (no payment) — it only ever serves the watermarked/downscaled preview, NEVER the original.
- Guard the id against path traversal: only use the validated link id from the registry lookup to build the path, never raw user input concatenated into a filesystem path.

### 4. Show it on the page — `src/app/link/[id]/page.tsx`
- When `link.hasPreview`, render `<img src={\`${basePath}/link/${link.id}/preview\`} alt={\`Watermarked preview of ${link.title}\`} />` in the header/surface, styled to fit the paper theme (add minimal CSS in `globals.css` if needed — bordered, max-width, rounded, matching existing cards).
- Add one honest line near it: "This is a watermarked preview — unlock to download the full-resolution original." Keep the existing "original host URL is not exposed" copy.
- If `hasPreview` is false, page renders exactly as today (no broken image).

### 5. Registration success card — `LinkRegistrationForm.tsx`
- After a successful registration, if the response indicates a preview exists, the success card can show the same preview so the photographer sees what buyers will see. (Optional but nice; only if the API returns `hasPreview` via `publicLink`.)

## Tests
- `link-preview.test.ts`: generated image → webp output, downscaled, watermark composited (assert dimensions + format; exact pixel match not required).
- `link-registration.test.ts`: registration writes a preview + sets `hasPreview: true` (mock `fetchImageBytes` + the preview writer via deps injection — follow the existing DI pattern in that file); a preview-generation failure still registers the link with `hasPreview` falsy and does not throw.
- preview route: unknown id → 404; `hasPreview` false → 404; valid → 200 webp (mock the file read via deps if the route supports injection, else a lightweight integration test).

## Operator tasks (NOT Codex)
- `npm ci` on the VPS (installs sharp native binary) as part of deploy; verify sharp loads on the box.
- Deploy + live-verify: register a real photo, confirm the preview renders on the gated page and is visibly watermarked/low-res, and that the full original still only comes through the paid download.

## Acceptance
- A buyer on `/aperture/link/[id]` sees a watermarked, downscaled preview of the photo (when one was generated) plus the "unlock for full resolution" framing.
- The preview route serves ONLY the watermarked webp; the original source URL and full-res bytes are never exposed without payment.
- Preview generation failure degrades gracefully (link still registers, page still works, no leak).
- Path-traversal-safe file serving; no raw user input in filesystem paths.
- `npm run typecheck && npm test && npm run build` green. No payment/x402/gate/nginx changes.
