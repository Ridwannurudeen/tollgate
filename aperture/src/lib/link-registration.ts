import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { WalletRegistryEntry } from "./types";
import {
  accountKeyHash,
  generateAccountKey,
  normalizeAccountEmail,
} from "./account";
import {
  LinkRegistryError,
  findLinkBySourceUrl,
  findNearDuplicateLink,
  markLinkPreviewGenerated,
  publicLink,
  registerLink,
  type LinkMediaKind,
  type PublicLinkRecord,
} from "./link-registry";
import { LINK_DOWNLOAD_MAX_BYTES, fetchImageBytes } from "./link-content";
import {
  originalExtensionForContentType,
  writeLinkOriginal,
} from "./link-originals";
import { buildWatermarkedPreview, writeLinkPreview } from "./link-preview";
import { registerCreator } from "./onboarding";
import { readWalletForOwner } from "./registry";
import { sha256Hex } from "./hash";
import { computeDHash, type DHashResult } from "./perceptual-hash";
import {
  buildVideoThumbnail,
  extractRepresentativeFrame,
  probeVideo,
} from "./video-content";

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 600;
const MAX_NAME_LENGTH = 80;
const MAX_UPLOAD_PIXELS = 50_000_000;
const MAX_UPLOAD_DIMENSION = 12_000;

export type LinkRegistrationInput = {
  sourceUrl?: unknown;
  title?: unknown;
  description?: unknown;
  displayName?: unknown;
  wallet?: unknown;
  email?: unknown;
};

export type LinkUploadRegistrationInput = {
  fileBytes: Uint8Array;
  mediaKind?: unknown;
  title?: unknown;
  description?: unknown;
  displayName?: unknown;
  wallet?: unknown;
  email?: unknown;
};

export type LinkRegistrationResult = {
  link: PublicLinkRecord;
  registered: Pick<
    WalletRegistryEntry,
    "ownerId" | "displayName" | "wallet" | "approvalStatus" | "custody"
  >;
  shareUrl: string;
  accountKey?: string;
};

export type LinkRegistrationDeps = {
  origin: string;
  basePath: string;
  registerCreator?: typeof registerCreator;
  registerLink?: typeof registerLink;
  markLinkPreviewGenerated?: typeof markLinkPreviewGenerated;
  findLinkBySourceUrl?: typeof findLinkBySourceUrl;
  findNearDuplicateLink?: typeof findNearDuplicateLink;
  fetchImageBytes?: typeof fetchImageBytes;
  computeDHash?: typeof computeDHash;
  buildWatermarkedPreview?: typeof buildWatermarkedPreview;
  buildVideoThumbnail?: typeof buildVideoThumbnail;
  extractRepresentativeFrame?: typeof extractRepresentativeFrame;
  writeLinkPreview?: typeof writeLinkPreview;
  writeLinkOriginal?: typeof writeLinkOriginal;
  probeVideo?: typeof probeVideo;
  readWalletForOwner?: typeof readWalletForOwner;
  generateAccountKey?: typeof generateAccountKey;
  ownerId?: () => string;
  linkId?: () => string;
  sessionOwnerId?: string;
};

function stringField(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new LinkRegistryError(`${label} is required.`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new LinkRegistryError(`${label} is required.`);
  if (trimmed.length > maxLength) {
    throw new LinkRegistryError(`${label} is too long.`);
  }
  return trimmed;
}

function optionalWallet(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new LinkRegistryError("wallet must be a string.");
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalEmail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new LinkRegistryError("email must be a string.");
  }
  if (!value.trim()) return undefined;
  const email = normalizeAccountEmail(value);
  if (!email) {
    throw new LinkRegistryError("email must be a valid address.");
  }
  return email;
}

function optionalDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new LinkRegistryError("description must be a string.");
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
    throw new LinkRegistryError("description is too long.");
  }
  return trimmed;
}

function mediaKind(value: unknown): LinkMediaKind {
  if (value === undefined || value === null || value === "") return "photo";
  if (value !== "photo" && value !== "video") {
    throw new LinkRegistryError("mediaKind must be photo or video.");
  }
  return value;
}

async function photographerForRegistration(
  input: Pick<LinkRegistrationInput, "displayName" | "wallet" | "email">,
  deps: LinkRegistrationDeps,
): Promise<{
  accountKey?: string;
  ownerId: string;
  photographer: WalletRegistryEntry;
}> {
  const sessionOwnerId = deps.sessionOwnerId?.trim();
  if (sessionOwnerId) {
    const existing = await (deps.readWalletForOwner ?? readWalletForOwner)(
      sessionOwnerId,
    );
    if (!existing) {
      throw new LinkRegistryError("creator session is no longer valid.", 401);
    }
    return { ownerId: existing.ownerId, photographer: existing };
  }

  const displayName = stringField(
    input.displayName,
    "photographer name",
    MAX_NAME_LENGTH,
  );
  const wallet = optionalWallet(input.wallet);
  const email = optionalEmail(input.email);
  const accountKey = (deps.generateAccountKey ?? generateAccountKey)();
  const ownerId = deps.ownerId?.() ?? `link-${randomUUID()}`;
  const photographer = await (deps.registerCreator ?? registerCreator)({
    ownerId,
    displayName,
    wallet,
    accountKeyHash: accountKeyHash(accountKey),
    ...(email ? { email } : {}),
  });
  return { accountKey, ownerId, photographer };
}

function uploadImageType(format: string | undefined): {
  contentType: string;
  ext: NonNullable<ReturnType<typeof originalExtensionForContentType>>;
} | null {
  switch (format) {
    case "jpeg":
      return { contentType: "image/jpeg", ext: "jpg" };
    case "png":
      return { contentType: "image/png", ext: "png" };
    case "webp":
      return { contentType: "image/webp", ext: "webp" };
    case "gif":
      return { contentType: "image/gif", ext: "gif" };
    case "avif":
      return { contentType: "image/avif", ext: "avif" };
    case "tiff":
      return { contentType: "image/tiff", ext: "tiff" };
    default:
      return null;
  }
}

async function uploadedImageEvidence(bytes: Uint8Array): Promise<{
  contentType: string;
  ext: NonNullable<ReturnType<typeof originalExtensionForContentType>>;
  sourceContentHash: `0x${string}`;
}> {
  if (bytes.byteLength > LINK_DOWNLOAD_MAX_BYTES) {
    throw new LinkRegistryError(
      "photo is larger than the 25 MB upload cap.",
      413,
    );
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(bytes).metadata();
  } catch {
    throw new LinkRegistryError("file is not a supported image.");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    width <= 0 ||
    height <= 0 ||
    width > MAX_UPLOAD_DIMENSION ||
    height > MAX_UPLOAD_DIMENSION ||
    width * height > MAX_UPLOAD_PIXELS
  ) {
    throw new LinkRegistryError("photo dimensions are too large.", 413);
  }
  const type = uploadImageType(metadata.format);
  if (!type) {
    throw new LinkRegistryError("file is not a supported image.");
  }

  return {
    ...type,
    sourceContentHash: sha256Hex({
      type: "aperture-upload-original",
      body: Buffer.from(bytes).toString("base64"),
    }),
  };
}

async function uploadedVideoEvidence(
  bytes: Uint8Array,
  probe: typeof probeVideo,
): Promise<{
  contentType: string;
  ext: NonNullable<ReturnType<typeof originalExtensionForContentType>>;
  sourceContentHash: `0x${string}`;
}> {
  const evidence = await probe(bytes);
  return {
    contentType: evidence.contentType,
    ext: evidence.ext,
    sourceContentHash: sha256Hex({
      type: "aperture-upload-original",
      body: Buffer.from(bytes).toString("base64"),
    }),
  };
}

// github.com/<owner>/<repo>/blob/<ref>/<path> is GitHub's HTML file-viewer page
// (content-type text/html), not the image itself, so pasting it fails the
// image-content-type check. Rewrite it to the raw.githubusercontent.com URL
// that actually serves the image bytes.
function normalizeGitHubBlobUrl(parsed: URL): URL | null {
  if (parsed.hostname !== "github.com") return null;
  const match = parsed.pathname.match(
    /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/,
  );
  if (!match) return null;
  const [, owner, repo, ref, path] = match;
  return new URL(
    `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
  );
}

// drive.google.com/file/d/<id>/view is Drive's HTML preview page (text/html).
// The uc?export=view&id=<id> endpoint 303-redirects to
// drive.usercontent.google.com, which serves the real image bytes; safeFetch
// already follows and re-validates redirects, so rewriting here is enough.
function normalizeGoogleDriveViewUrl(parsed: URL): URL | null {
  if (parsed.hostname !== "drive.google.com") return null;
  const match = parsed.pathname.match(/^\/file\/d\/([^/]+)/);
  if (!match) return null;
  const [, fileId] = match;
  return new URL(`https://drive.google.com/uc?export=view&id=${fileId}`);
}

function normalizeKnownViewerUrl(parsed: URL): URL {
  return (
    normalizeGitHubBlobUrl(parsed) ??
    normalizeGoogleDriveViewUrl(parsed) ??
    parsed
  );
}

function sourceUrl(value: unknown): string {
  const raw = stringField(value, "photo URL", MAX_URL_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new LinkRegistryError("photo URL must be a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new LinkRegistryError("photo URL must use http or https.");
  }
  parsed = normalizeKnownViewerUrl(parsed);
  parsed.hash = "";
  return parsed.toString();
}

async function rejectNearDuplicate(
  perceptualHash: DHashResult,
  deps: LinkRegistrationDeps,
): Promise<void> {
  if (perceptualHash.lowDetail) {
    // Flat media has no useful dHash signal; this intentionally accepts even
    // exact flat repeats rather than rejecting unrelated solid-color works.
    return;
  }
  const duplicate = await (
    deps.findNearDuplicateLink ?? findNearDuplicateLink
  )(perceptualHash.hash);
  if (duplicate) {
    throw new LinkRegistryError(
      "this looks like content that's already registered on Tollgate.",
      409,
    );
  }
}

export async function handleLinkRegistration(
  input: LinkRegistrationInput,
  deps: LinkRegistrationDeps,
): Promise<LinkRegistrationResult> {
  const url = sourceUrl(input.sourceUrl);
  const title = stringField(input.title, "title", MAX_TITLE_LENGTH);
  const description = optionalDescription(input.description);
  const findExisting = deps.findLinkBySourceUrl ?? findLinkBySourceUrl;
  if (await findExisting(url)) {
    throw new LinkRegistryError("photo URL already registered.", 409);
  }

  const image = await (deps.fetchImageBytes ?? fetchImageBytes)(url);
  const perceptualHash = await (deps.computeDHash ?? computeDHash)(image.bytes);
  await rejectNearDuplicate(perceptualHash, deps);
  const { accountKey, ownerId, photographer } =
    await photographerForRegistration(input, deps);
  const link = await (deps.registerLink ?? registerLink)({
    title,
    ...(description ? { description } : {}),
    ownerId,
    sourceUrl: url,
    contentType: image.contentType,
    sourceContentHash: image.sourceContentHash,
    perceptualHash: perceptualHash.hash,
  });
  let resultLink = link;
  try {
    const preview = await (
      deps.buildWatermarkedPreview ?? buildWatermarkedPreview
    )(image.bytes);
    await (deps.writeLinkPreview ?? writeLinkPreview)(link.id, preview.bytes);
    resultLink = await (
      deps.markLinkPreviewGenerated ?? markLinkPreviewGenerated
    )(link.id);
  } catch (error) {
    console.warn(
      `Skipping Aperture preview for ${link.id}: ${
        error instanceof Error ? error.message : "preview generation failed"
      }`,
    );
  }
  return {
    link: publicLink(resultLink),
    registered: {
      ownerId: photographer.ownerId,
      displayName: photographer.displayName,
      wallet: photographer.wallet,
      approvalStatus: photographer.approvalStatus,
      custody: photographer.custody,
    },
    shareUrl: `${deps.origin}${deps.basePath}/link/${link.id}`,
    ...(accountKey ? { accountKey } : {}),
  };
}

export async function handleLinkUploadRegistration(
  input: LinkUploadRegistrationInput,
  deps: LinkRegistrationDeps,
): Promise<LinkRegistrationResult> {
  const title = stringField(input.title, "title", MAX_TITLE_LENGTH);
  const description = optionalDescription(input.description);
  const kind = mediaKind(input.mediaKind);
  const evidence =
    kind === "video"
      ? await uploadedVideoEvidence(input.fileBytes, deps.probeVideo ?? probeVideo)
      : await uploadedImageEvidence(input.fileBytes);
  const representativeBytes =
    kind === "video"
      ? await (deps.extractRepresentativeFrame ?? extractRepresentativeFrame)(
          input.fileBytes,
        )
      : input.fileBytes;
  const perceptualHash = await (deps.computeDHash ?? computeDHash)(
    representativeBytes,
  );
  await rejectNearDuplicate(perceptualHash, deps);
  const { accountKey, ownerId, photographer } =
    await photographerForRegistration(input, deps);
  const id = deps.linkId?.() ?? randomUUID();
  const preview =
    kind === "video"
      ? await (deps.buildVideoThumbnail ?? buildVideoThumbnail)(input.fileBytes)
      : await (deps.buildWatermarkedPreview ?? buildWatermarkedPreview)(
          input.fileBytes,
        );
  await (deps.writeLinkPreview ?? writeLinkPreview)(id, preview.bytes);
  await (deps.writeLinkOriginal ?? writeLinkOriginal)(
    id,
    input.fileBytes,
    evidence.ext,
  );
  const link = await (deps.registerLink ?? registerLink)({
    id,
    title,
    ...(description ? { description } : {}),
    ownerId,
    ...(kind === "video" ? { mediaKind: kind } : {}),
    sourceKind: "upload",
    originalContentType: evidence.contentType,
    sourceContentHash: evidence.sourceContentHash,
    perceptualHash: perceptualHash.hash,
    hasPreview: true,
  });

  return {
    link: publicLink(link),
    registered: {
      ownerId: photographer.ownerId,
      displayName: photographer.displayName,
      wallet: photographer.wallet,
      approvalStatus: photographer.approvalStatus,
      custody: photographer.custody,
    },
    shareUrl: `${deps.origin}${deps.basePath}/link/${link.id}`,
    ...(accountKey ? { accountKey } : {}),
  };
}
