import { lookup } from "node:dns/promises";
import { BlockList, isIP, type TcpNetConnectOpts } from "node:net";
import {
  Agent,
  fetch as undiciFetch,
  type Dispatcher,
} from "undici";

export const SAFE_FETCH_MAX_REDIRECTS = 3;
const SAFE_FETCH_TIMEOUT_MS = 10_000;

function stripBrackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

const unsafeAddresses = new BlockList();
unsafeAddresses.addSubnet("0.0.0.0", 8, "ipv4");
unsafeAddresses.addSubnet("10.0.0.0", 8, "ipv4");
unsafeAddresses.addSubnet("100.64.0.0", 10, "ipv4");
unsafeAddresses.addSubnet("127.0.0.0", 8, "ipv4");
unsafeAddresses.addSubnet("172.16.0.0", 12, "ipv4");
unsafeAddresses.addSubnet("169.254.0.0", 16, "ipv4");
unsafeAddresses.addSubnet("192.0.0.0", 24, "ipv4");
unsafeAddresses.addSubnet("192.0.2.0", 24, "ipv4");
unsafeAddresses.addSubnet("192.88.99.0", 24, "ipv4");
unsafeAddresses.addSubnet("192.168.0.0", 16, "ipv4");
unsafeAddresses.addSubnet("198.18.0.0", 15, "ipv4");
unsafeAddresses.addSubnet("198.51.100.0", 24, "ipv4");
unsafeAddresses.addSubnet("203.0.113.0", 24, "ipv4");
unsafeAddresses.addSubnet("224.0.0.0", 4, "ipv4");
unsafeAddresses.addSubnet("240.0.0.0", 4, "ipv4");
unsafeAddresses.addAddress("::", "ipv6");
unsafeAddresses.addAddress("::1", "ipv6");
unsafeAddresses.addSubnet("64:ff9b:1::", 48, "ipv6");
unsafeAddresses.addSubnet("100::", 64, "ipv6");
unsafeAddresses.addSubnet("100:0:0:1::", 64, "ipv6");
unsafeAddresses.addSubnet("2001::", 23, "ipv6");
unsafeAddresses.addSubnet("2001:db8::", 32, "ipv6");
unsafeAddresses.addSubnet("2002::", 16, "ipv6");
unsafeAddresses.addSubnet("3fff::", 20, "ipv6");
unsafeAddresses.addSubnet("5f00::", 16, "ipv6");
unsafeAddresses.addSubnet("fc00::", 7, "ipv6");
unsafeAddresses.addSubnet("fe80::", 10, "ipv6");
unsafeAddresses.addSubnet("fec0::", 10, "ipv6");
unsafeAddresses.addSubnet("ff00::", 8, "ipv6");

const globallyReachableAddresses = new BlockList();
globallyReachableAddresses.addAddress("192.0.0.9", "ipv4");
globallyReachableAddresses.addAddress("192.0.0.10", "ipv4");
globallyReachableAddresses.addSubnet("64:ff9b::", 96, "ipv6");
globallyReachableAddresses.addAddress("2001:1::1", "ipv6");
globallyReachableAddresses.addAddress("2001:1::2", "ipv6");
globallyReachableAddresses.addAddress("2001:1::3", "ipv6");
globallyReachableAddresses.addSubnet("2001:3::", 32, "ipv6");
globallyReachableAddresses.addSubnet("2001:4:112::", 48, "ipv6");
globallyReachableAddresses.addSubnet("2001:20::", 28, "ipv6");
globallyReachableAddresses.addSubnet("2001:30::", 28, "ipv6");

const globalIpv6Unicast = new BlockList();
globalIpv6Unicast.addSubnet("2000::", 3, "ipv6");

const unsafeNat64Addresses = new BlockList();
unsafeNat64Addresses.addSubnet("64:ff9b::", 104, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::a00:0", 104, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::6440:0", 106, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::7f00:0", 104, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::a9fe:0", 112, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::ac10:0", 108, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::c000:0", 120, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::c000:200", 120, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::c058:6300", 120, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::c0a8:0", 112, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::c612:0", 111, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::c633:6400", 120, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::cb00:7100", 120, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::e000:0", 100, "ipv6");
unsafeNat64Addresses.addSubnet("64:ff9b::f000:0", 100, "ipv6");

const globallyReachableNat64Addresses = new BlockList();
globallyReachableNat64Addresses.addAddress("64:ff9b::c000:9", "ipv6");
globallyReachableNat64Addresses.addAddress("64:ff9b::c000:a", "ipv6");

export function isUnsafeFetchHost(hostname: string): boolean {
  const host = stripBrackets(hostname.toLowerCase());
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const family = isIP(host);
  if (family === 4) {
    if (globallyReachableAddresses.check(host, "ipv4")) return false;
    return unsafeAddresses.check(host, "ipv4");
  }
  if (family === 6) {
    if (globallyReachableNat64Addresses.check(host, "ipv6")) return false;
    if (unsafeNat64Addresses.check(host, "ipv6")) return true;
    if (globallyReachableAddresses.check(host, "ipv6")) return false;
    return (
      unsafeAddresses.check(host, "ipv6") ||
      !globalIpv6Unicast.check(host, "ipv6")
    );
  }
  return false;
}

export type ResolveHost = (hostname: string) => Promise<string[]>;

const defaultResolveHost: ResolveHost = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => result.address);
};

export type ResolvedFetchAddress = {
  address: string;
  family: 4 | 6;
};

export type CreatePinnedDispatcher = (
  address: ResolvedFetchAddress,
) => Dispatcher;

async function resolveSafeFetchAddress(
  url: URL,
  resolveHost: ResolveHost = defaultResolveHost,
): Promise<ResolvedFetchAddress> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("fetch target must use http or https.");
  }
  if (isUnsafeFetchHost(url.hostname)) {
    throw new Error("fetch target host is not allowed.");
  }
  const literal = stripBrackets(url.hostname);
  const literalFamily = isIP(literal);
  if (literalFamily === 4 || literalFamily === 6) {
    return { address: literal, family: literalFamily === 4 ? 4 : 6 };
  }
  let addresses: string[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new Error("fetch target host did not resolve.");
  }
  if (addresses.length === 0) {
    throw new Error("fetch target host did not resolve.");
  }
  const resolved = addresses.map<ResolvedFetchAddress>((address) => {
    const normalized = stripBrackets(address);
    const family = isIP(normalized);
    if (family !== 4 && family !== 6) {
      throw new Error("fetch target host did not resolve.");
    }
    return { address: normalized, family: family === 4 ? 4 : 6 };
  });
  if (resolved.some(({ address }) => isUnsafeFetchHost(address))) {
    throw new Error("fetch target resolves to a blocked address.");
  }
  return resolved[0];
}

export async function assertSafeFetchTarget(
  url: URL,
  resolveHost: ResolveHost = defaultResolveHost,
): Promise<void> {
  await resolveSafeFetchAddress(url, resolveHost);
}

const defaultCreateDispatcher: CreatePinnedDispatcher = (address) => {
  const pinnedLookup: NonNullable<TcpNetConnectOpts["lookup"]> = (
    _hostname,
    options,
    callback,
  ) => {
    if (options.all) {
      callback(null, [address]);
      return;
    }
    callback(null, address.address, address.family);
  };
  return new Agent({
    connections: 1,
    connect: { lookup: pinnedLookup },
  });
};

async function responseWithDispatcher(
  response: Response,
  dispatcher: Dispatcher,
): Promise<Response> {
  if (!response.body) {
    await dispatcher.close();
    return response;
  }
  const reader = response.body.getReader();
  let finalized = false;
  async function finalize(error?: unknown): Promise<void> {
    if (finalized) return;
    finalized = true;
    if (error !== undefined) {
      await dispatcher.destroy(
        error instanceof Error ? error : new Error("response stream failed."),
      );
      return;
    }
    await dispatcher.close();
  }
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await finalize();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        await finalize(error);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await finalize();
      }
    },
  });
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export async function readCappedResponseBytes(
  response: Response,
  maxBytes: number,
  mode: "reject" | "truncate" = "reject",
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let exceeded = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = maxBytes - totalBytes;
      if (value.byteLength > remaining) {
        exceeded = true;
        if (mode === "truncate" && remaining > 0) {
          chunks.push(value.slice(0, remaining));
          totalBytes += remaining;
        }
        break;
      }
      chunks.push(value);
      totalBytes += value.byteLength;
    }
  } finally {
    if (exceeded) {
      await reader.cancel();
    } else {
      reader.releaseLock();
    }
  }
  if (exceeded && mode === "reject") {
    throw new Error(`response body exceeds the ${maxBytes}-byte limit.`);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readCappedResponseText(
  response: Response,
  maxBytes: number,
  mode: "reject" | "truncate" = "reject",
): Promise<string> {
  return new TextDecoder().decode(
    await readCappedResponseBytes(response, maxBytes, mode),
  );
}

export type SafeFetchOptions = {
  createDispatcher?: CreatePinnedDispatcher;
  fetchImpl?: typeof fetch;
  resolveHost?: ResolveHost;
  maxRedirects?: number;
};

export async function safeFetch(
  target: URL | string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> {
  const fetchImpl =
    options.fetchImpl ?? (undiciFetch as unknown as typeof fetch);
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const createDispatcher =
    options.createDispatcher ?? defaultCreateDispatcher;
  const maxRedirects = options.maxRedirects ?? SAFE_FETCH_MAX_REDIRECTS;
  const signal = init.signal ?? AbortSignal.timeout(SAFE_FETCH_TIMEOUT_MS);
  let url = new URL(target);
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const address = await resolveSafeFetchAddress(url, resolveHost);
    const dispatcher = createDispatcher(address);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        signal,
        redirect: "manual",
        dispatcher,
      } as RequestInit);
    } catch (error) {
      await dispatcher.destroy(
        error instanceof Error ? error : new Error("fetch failed."),
      );
      throw error;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return responseWithDispatcher(response, dispatcher);
      if (response.body) await response.body.cancel();
      await dispatcher.close();
      url = new URL(location, url);
      continue;
    }
    return responseWithDispatcher(response, dispatcher);
  }
  throw new Error("fetch followed too many redirects.");
}
