import { randomUUID } from "node:crypto";
import type { WalletRegistryEntry } from "./types";
import {
  LinkRegistryError,
  findLinkBySourceUrl,
  publicLink,
  registerLink,
  type PublicLinkRecord,
} from "./link-registry";
import { probeImageSource } from "./link-content";
import { registerCreator } from "./onboarding";

const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 120;
const MAX_NAME_LENGTH = 80;

export type LinkRegistrationInput = {
  sourceUrl?: unknown;
  title?: unknown;
  displayName?: unknown;
  wallet?: unknown;
};

export type LinkRegistrationResult = {
  link: PublicLinkRecord;
  registered: Pick<
    WalletRegistryEntry,
    "displayName" | "wallet" | "approvalStatus" | "custody"
  >;
  shareUrl: string;
};

export type LinkRegistrationDeps = {
  origin: string;
  basePath: string;
  registerCreator?: typeof registerCreator;
  registerLink?: typeof registerLink;
  findLinkBySourceUrl?: typeof findLinkBySourceUrl;
  probeImageSource?: typeof probeImageSource;
  ownerId?: () => string;
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

export async function handleLinkRegistration(
  input: LinkRegistrationInput,
  deps: LinkRegistrationDeps,
): Promise<LinkRegistrationResult> {
  const url = sourceUrl(input.sourceUrl);
  const title = stringField(input.title, "title", MAX_TITLE_LENGTH);
  const displayName = stringField(
    input.displayName,
    "photographer name",
    MAX_NAME_LENGTH,
  );
  const wallet = optionalWallet(input.wallet);
  const findExisting = deps.findLinkBySourceUrl ?? findLinkBySourceUrl;
  if (await findExisting(url)) {
    throw new LinkRegistryError("photo URL already registered.", 409);
  }

  const evidence = await (deps.probeImageSource ?? probeImageSource)(url);
  const ownerId = deps.ownerId?.() ?? `link-${randomUUID()}`;
  const photographer = await (deps.registerCreator ?? registerCreator)({
    ownerId,
    displayName,
    wallet,
  });
  const link = await (deps.registerLink ?? registerLink)({
    title,
    ownerId,
    sourceUrl: url,
    contentType: evidence.contentType,
    sourceContentHash: evidence.sourceContentHash,
  });
  return {
    link: publicLink(link),
    registered: {
      displayName: photographer.displayName,
      wallet: photographer.wallet,
      approvalStatus: photographer.approvalStatus,
      custody: photographer.custody,
    },
    shareUrl: `${deps.origin}${deps.basePath}/link/${link.id}`,
  };
}
