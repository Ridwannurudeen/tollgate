# Codex scope — self-serve video licensing (generalize Aperture, no PeerTube needed)

Today Tollgate's only "video" surface is `citations/src/app/video/page.tsx` — a static showcase page describing a PeerTube plugin integration, with one hardcoded historical payout tx. There is NO self-serve path: no way for a video creator to register a video, no way for a viewer to pay and download one, and it requires a separately-hosted PeerTube instance most people don't have.

**Goal:** make video work exactly like Aperture's photo flow — paste a link or upload a file, get a thumbnail preview, get a gated pay-to-download page, get paid on Arc the moment someone buys it. Reuse Aperture's account/session/x402/dashboard infrastructure; do NOT build a parallel system.

**Verified feasibility:** `ffmpeg`/`ffprobe` are system-installed on the VPS (`/usr/bin/ffmpeg`, v6.1.1) — usable via Node `child_process`, no new system dependency to install. Disk: VPS has ~111GB free on a shared, 91%-full disk hosting other live projects — **cap video uploads conservatively (100MB)**, well under the photo cap's headroom-per-file ratio, and do not touch other apps' footprint.

All in `aperture/`. Read every file before editing — especially `link-registry.ts`, `link-registration.ts`, `link-download.ts`, `link-preview.ts`, `link-originals.ts`, `link-content.ts`, `account.ts`, and the `dashboard`/`browse`/`link/[id]` pages, since this generalizes them rather than forking them. Run `npm run typecheck && npm test && npm run build`. Do NOT touch payment/x402/fee-router/settlement logic itself — reuse it as-is. Do NOT touch citations/ (the old `/video` showcase page can stay untouched; this is a new, separate, real feature).

## Design: one `mediaKind`, not a parallel system

- Add `mediaKind?: "photo" | "video"` to `LinkRecord` / `PublicLinkRecord` / `RegisterLinkInput` (absent/`"photo"` = fully back-compat with everything shipped today). This is the ONLY structural addition to the registry — reuse `id`, `title`, `description`, `ownerId`, `sourceKind` (`url`/`upload`), `sourceUrl`/originals-store fields, `priceAtomicUsdc`, `hasPreview` exactly as-is for both kinds.
- Reuse the account system, session auth, dashboard, x402 download gate, and browse listing UNCHANGED — they already operate on `LinkRecord`/`PublicLinkRecord` generically and don't care what the bytes represent.

## Build

### 1. Video validation + thumbnail (`src/lib/video-content.ts`, new — mirrors `link-preview.ts`)
- `probeVideo(bytes: Uint8Array): Promise<{ contentType: string; ext: "mp4"|"webm"|"mov"; durationSeconds: number; width: number; height: number }>`:
  - Write bytes to a temp file (`os.tmpdir()`, random name, delete in a `finally`).
  - Run `ffprobe -v error -show_entries format=duration:stream=width,height,codec_type -of json <tmpfile>` via `child_process.execFile` (NOT `exec` — avoid shell injection; pass args as an array). Parse JSON output.
  - Reject if no video stream, if `durationSeconds` is absent/zero, or if the file isn't a real decodable video (`ffprobe` exits non-zero) → throw a clear `LinkRegistryError`.
  - Reject if bytes exceed a `VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024` (100MB) cap — check BEFORE writing to disk/running ffprobe.
  - Derive `contentType`/`ext` from the codec/container `ffprobe` reports, not from any client-supplied filename/mimetype (same non-client-trust principle as the photo upload validator).
- `buildVideoThumbnail(bytes: Uint8Array): Promise<{ bytes: Uint8Array; contentType: "image/webp" }>`:
  - Write bytes to a temp file. Run `ffmpeg -y -ss 00:00:01 -i <tmpfile> -frames:v 1 -vf "scale=600:-1" <tmp-out>.webp` via `execFile` (array args). Read the output file, delete both temp files in `finally`.
  - If `ffmpeg` fails (e.g. video shorter than 1s), retry with `-ss 00:00:00`.
  - Compose the SAME watermark overlay as `link-preview.ts`'s `watermarkSvg` (reuse/export that function so photo and video previews look consistent) over the extracted frame instead of building a new watermark design.
  - Throw on failure — never fall back to unwatermarked/original frame.

### 2. Video originals store (`src/lib/link-originals.ts` — extend, don't fork)
- Extend `LinkOriginalExtension` to include `"mp4" | "webm" | "mov"` and `originalExtensionForContentType` to map video content-types. Reuse `writeLinkOriginal`/`readLinkOriginal`/`assertLinkOriginalReadable`/the traversal guard AS-IS — they're already extension-parameterized and path-safe; just extend the allowed-extension set.

### 3. Registration (`src/lib/link-registration.ts` — extend `handleLinkUploadRegistration` and the URL path)
- Detect intended media kind from the upload's validated bytes (try image validation first via existing `uploadedImageEvidence`; if that fails, try `probeVideo`; if both fail, reject) OR accept an explicit `mediaKind` hint from the form and validate accordingly — pick whichever is less invasive to the existing function signatures; prefer an explicit hint field (`input.mediaKind`) since it avoids fragile double-probing.
- For a video upload: call `probeVideo`, then `buildVideoThumbnail`, `writeLinkPreview` (same call, video thumbnail is still a webp), `writeLinkOriginal` with the video extension, `registerLink({ ..., mediaKind: "video", originalContentType, sourceContentHash, hasPreview: true })`.
- For a pasted video URL: mirror the existing `sourceUrl` path (`fetchImageBytes`-equivalent for video would need a size-capped video fetch — reuse the existing SSRF-safe `safeFetch` plumbing with a video-specific max-bytes cap, or scope pasted-video-URL support out of v1 and ship upload-only for video first if that keeps this scope tighter — recommend upload-only for video initially, matching what most non-technical creators will actually do, and note URL-based video as a fast-follow).

### 4. Download gate (`src/lib/link-download.ts` — extend the existing `sourceKind === "upload"` branch)
- Already generic on `readLinkOriginal(link.id, ext)` — just ensure `ext` resolution handles the video extensions added in step 2. No new gating logic; the x402 402/settle/serve flow is unchanged. Set `content-type`/`content-disposition` from `originalContentType` as already done for photos.

### 5. UI
- `LinkRegistrationForm.tsx`: add a media-type toggle (Photo / Video) next to the existing Upload/Link toggle; video mode = upload-only per step 3's recommendation, `accept="video/mp4,video/webm,video/quicktime"`.
- `browse/page.tsx` and `dashboard/page.tsx`: when `mediaKind === "video"`, render the thumbnail with a small "▶ video" badge overlay so it's visually distinct from a photo card; everything else (price, description, share link) unchanged.
- `link/[id]/page.tsx`: same thumbnail + badge; copy should say "watermarked thumbnail preview — unlock to download the full video" instead of photo-specific wording when `mediaKind === "video"`.

## Tests
- `video-content.ts`: a real short generated test clip (ffmpeg can synthesize one: `ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=10 -f lavfi -i anullsrc test.mp4`) → probes correctly, thumbnail extracts, is watermarked, is webp, ≤600px; corrupt bytes → throws; oversized → rejected before probing; non-video (e.g. a jpeg) → rejected.
- registration: video upload registers with `mediaKind: "video"`, thumbnail + original stored; existing photo tests unaffected (regression guard — `mediaKind` absent/`"photo"` behaves identically to before this change).
- download: a video link's gated download serves the original video bytes with the right content-type only after settlement, mirroring the existing photo regression tests.
- No public output (browse/dashboard/proof-pack) leaks the original video path/URL — same sanitization pattern as photos.

## Security invariants
- `execFile` with array args ONLY — never `exec`/string-interpolated shell commands (command injection risk with ffmpeg/ffprobe).
- Temp files cleaned up in `finally` blocks even on error paths.
- 100MB cap enforced BEFORE writing to disk or invoking ffprobe/ffmpeg.
- Video type/extension derived from ffprobe's decoded output, never from client-supplied filename/mimetype.
- Same path-traversal-safe storage as photos (extension allowlist + relative-path guard, unchanged).
- Original video bytes served ONLY through the existing paid x402 gate — never a public route.
- No new npm dependency (ffmpeg/ffprobe are system binaries, invoked via Node's built-in `child_process`).

## Operator tasks (NOT Codex)
- Confirm `ffmpeg`/`ffprobe` remain available at `/usr/bin/` on the VPS (already verified present).
- Monitor disk usage after shipping — video uploads are much larger than photos on an already-91%-full shared disk; consider a lower cap or periodic cleanup policy if usage climbs.
- Deploy + live-verify: upload a real short video, confirm a watermarked thumbnail appears on browse/dashboard/link page, confirm the gated download only serves the file after a real settlement, confirm existing PHOTO upload/browse/download flows are completely unaffected (regression check).

## Acceptance
- A creator can upload a video directly (no PeerTube, no link required) and get a watermarked thumbnail + gated pay-to-download page, exactly like a photo.
- Existing photo functionality (upload, link-based, browse, dashboard, download) is unchanged — verified via regression tests, not just "should still work."
- No command injection, no path traversal, no unwatermarked/original leakage, size-capped before heavy processing.
- `npm run typecheck && npm test && npm run build` green. No new dependency. No payment/settlement logic changes.
