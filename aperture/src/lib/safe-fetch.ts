import { lookup } from "node:dns/promises";

export const SAFE_FETCH_MAX_REDIRECTS = 3;

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

export function isUnsafeFetchHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "0.0.0.0") return true;
  if (
    host.startsWith("127.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("169.254.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
  ) {
    return true;
  }
  if (host.includes(":")) {
    if (host === "::" || host === "::1") return true;
    if (/^fe[89ab]/.test(host)) return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isUnsafeFetchHost(mapped[1]);
  }
  return false;
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

const defaultResolveHost: ResolveHost = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
};

function isCanonicalDottedQuad(host: string): boolean {
  const octets = host.split(".");
  if (octets.length !== 4) return false;
  return octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const n = Number(octet);
    return n >= 0 && n <= 255;
  });
}

function isIpLiteral(hostname: string): boolean {
  const host = stripBrackets(hostname);
  if (host.includes(":")) return true;
  return isCanonicalDottedQuad(host);
}

export async function assertSafeFetchTarget(
  url: URL,
  resolveHost: ResolveHost = defaultResolveHost,
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("fetch target must use http or https.");
  }
  if (isUnsafeFetchHost(url.hostname)) {
    throw new Error("fetch target host is not allowed.");
  }
  if (isIpLiteral(url.hostname)) return;
  let addresses: string[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new Error("fetch target host did not resolve.");
  }
  if (addresses.length === 0) {
    throw new Error("fetch target host did not resolve.");
  }
  if (addresses.some((address) => isUnsafeFetchHost(address))) {
    throw new Error("fetch target resolves to a blocked address.");
  }
}

export type SafeFetchOptions = {
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  maxRedirects?: number;
};

export async function safeFetch(
  target: URL | string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_MAX_REDIRECTS;
  let url = new URL(target);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertSafeFetchTarget(url, resolveHost);
    const response = await fetchImpl(url, { ...init, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new Error("fetch followed too many redirects.");
}
