const DEFAULT_LEPTONWEB_PUBLIC_ORIGIN = "https://tollgate.gudman.xyz";
const DEFAULT_LEPTONWEB_INTERNAL_ORIGIN = "http://127.0.0.1:3091";

function httpOrigin(configured: string, variableName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error(`${variableName} must be an HTTP(S) origin.`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`${variableName} must be an HTTP(S) origin.`);
  }
  return parsed.origin;
}

export function leptonwebPublicOrigin(): string {
  return httpOrigin(
    process.env.LEPTONWEB_PUBLIC_URL?.trim() ||
      DEFAULT_LEPTONWEB_PUBLIC_ORIGIN,
    "LEPTONWEB_PUBLIC_URL",
  );
}

export function leptonwebInternalOrigin(): string {
  return httpOrigin(
    process.env.LEPTONWEB_INTERNAL_ORIGIN?.trim() ||
      DEFAULT_LEPTONWEB_INTERNAL_ORIGIN,
    "LEPTONWEB_INTERNAL_ORIGIN",
  );
}
