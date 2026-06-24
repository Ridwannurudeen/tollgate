import type {
  DownloadArchiveEvent,
  ImmichAsset,
  ImmichSharedLink,
} from "./types";

const NGINX_LINE =
  /^(?<remoteAddress>\S+) \S+ \S+ \[(?<timestamp>[^\]]+)] "(?<method>[A-Z]+) (?<target>[^"]+) HTTP\/[^"]+" (?<status>\d{3}|-) \S+ "(?<referer>[^"]*)" "(?<userAgent>[^"]*)"/;

function parseNginxTimestamp(value: string): string {
  const match =
    /^(?<day>\d{2})\/(?<month>[A-Za-z]{3})\/(?<year>\d{4}):(?<time>\d{2}:\d{2}:\d{2}) (?<offset>[+-]\d{4})$/.exec(
      value,
    );
  if (!match?.groups) return new Date().toISOString();
  const months: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };
  const offset = `${match.groups.offset.slice(0, 3)}:${match.groups.offset.slice(3)}`;
  return new Date(
    `${match.groups.year}-${months[match.groups.month]}-${match.groups.day}T${match.groups.time}${offset}`,
  ).toISOString();
}

function normalizeEmptyHeader(value: string): string | null {
  return value === "-" ? null : value;
}

export function parseDownloadArchiveAccessLog(
  line: string,
): DownloadArchiveEvent | null {
  const match = NGINX_LINE.exec(line);
  if (!match?.groups) return null;
  if (match.groups.method !== "POST") return null;

  const url = new URL(match.groups.target, "http://aperture.local");
  if (url.pathname !== "/api/download/archive") return null;

  const sharedLinkKey = url.searchParams.get("key");
  if (!sharedLinkKey) return null;

  return {
    remoteAddress: match.groups.remoteAddress,
    method: "POST",
    path: "/api/download/archive",
    sharedLinkKey,
    status:
      match.groups.status === "-" ? null : Number.parseInt(match.groups.status),
    userAgent: normalizeEmptyHeader(match.groups.userAgent),
    referer: normalizeEmptyHeader(match.groups.referer),
    createdAt: parseNginxTimestamp(match.groups.timestamp),
    rawLine: line,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseAsset(value: unknown): ImmichAsset {
  if (!isRecord(value)) throw new Error("Immich asset is not an object.");
  const id = value.id;
  const ownerId = value.ownerId;
  const originalFileName = value.originalFileName;
  const originalPath = value.originalPath;
  if (typeof id !== "string") throw new Error("Immich asset id is missing.");
  if (typeof ownerId !== "string") {
    throw new Error("Immich asset ownerId is missing.");
  }
  if (typeof originalFileName !== "string") {
    throw new Error("Immich asset originalFileName is missing.");
  }
  return {
    id,
    ownerId,
    originalFileName,
    ...(typeof originalPath === "string" ? { originalPath } : {}),
  };
}

export function parseSharedLink(value: unknown): ImmichSharedLink {
  if (!isRecord(value)) throw new Error("Immich shared link is not an object.");
  const id = value.id;
  const key = value.key;
  const assets = value.assets;
  if (typeof id !== "string") throw new Error("Immich shared link id missing.");
  if (typeof key !== "string") {
    throw new Error("Immich shared link key missing.");
  }
  if (!Array.isArray(assets)) {
    throw new Error("Immich shared link assets missing.");
  }
  return { id, key, assets: assets.map(parseAsset) };
}

function sharedLinkUrl(apiBaseUrl: string, key: string): URL {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const url = new URL("shared-links/me", base);
  url.searchParams.set("key", key);
  return url;
}

export async function resolveSharedLink(
  apiBaseUrl: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ImmichSharedLink> {
  const response = await fetchImpl(sharedLinkUrl(apiBaseUrl, key));
  if (!response.ok) {
    throw new Error(
      `Immich shared-link resolve failed with ${response.status}.`,
    );
  }
  return parseSharedLink((await response.json()) as unknown);
}
