import { NextRequest, NextResponse } from "next/server";
import { SourceRegistryError, appendSource, publicSource } from "@/lib/catalog";
import {
  discoveryRegistrations,
  parseTollgateJson,
  parseTollgateMeta,
  type TollgateDeclaration,
} from "@/lib/discovery";
import { assertDiscoveryRateLimit } from "@/lib/rate-limit";
import { safeFetch } from "@/lib/safe-fetch";
import type { CreatorSource } from "@/lib/types";

export const runtime = "nodejs";

const DISCOVERY_TIMEOUT_MS = 5_000;
const MAX_DISCOVERY_SOURCES = 20;
const MAX_DISCOVERY_BODY_BYTES = 512 * 1024;
const DISCOVERY_NOTE =
  "Discovered sources are registered as probationary until ownership is verified.";

// Prefer the proxy-set x-real-ip (nginx/edge) over the client-controlled
// left-most x-forwarded-for, so the rate-limit bucket key cannot be spoofed
// by rotating the XFF header.
function requestIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim());
    // right-most entry is the closest trusted hop when no x-real-ip exists
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "local";
}

// Reads a discovery response body with a hard size cap so a malicious host
// cannot stream a huge body to exhaust memory within the timeout window.
async function readCappedText(response: Response): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_DISCOVERY_BODY_BYTES) {
    return null;
  }
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DISCOVERY_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(
    chunks.reduce<Uint8Array>((acc, chunk) => {
      const merged = new Uint8Array(acc.length + chunk.length);
      merged.set(acc);
      merged.set(chunk, acc.length);
      return merged;
    }, new Uint8Array(0)),
  );
}

function publisherUrl(value: unknown): URL {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SourceRegistryError("url is required.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SourceRegistryError("url must be a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SourceRegistryError("url must use http or https.");
  }
  return url;
}

// safeFetch failures (blocked address, no resolve, timeout) are swallowed to
// null so the response can't be used as an SSRF reconnaissance oracle that
// distinguishes internal-host states from a normal "not found".
async function fetchTollgateJson(
  url: URL,
): Promise<TollgateDeclaration | null> {
  const declarationUrl = new URL("/.well-known/tollgate.json", url);
  try {
    const response = await safeFetch(declarationUrl, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await readCappedText(response);
    if (text === null) return null;
    return parseTollgateJson(JSON.parse(text), url.toString());
  } catch {
    return null;
  }
}

async function fetchTollgateMeta(
  url: URL,
): Promise<TollgateDeclaration | null> {
  try {
    const response = await safeFetch(url, {
      headers: { accept: "text/html, application/xhtml+xml" },
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const text = await readCappedText(response);
    if (text === null) return null;
    return parseTollgateMeta(text, url.toString());
  } catch {
    return null;
  }
}

async function discoverDeclaration(url: URL): Promise<TollgateDeclaration> {
  const declaration =
    (await fetchTollgateJson(url)) ?? (await fetchTollgateMeta(url));
  if (!declaration) {
    throw new SourceRegistryError(
      "no tollgate.json or <meta name=tollgate> found at this URL",
      404,
    );
  }
  return declaration;
}

function registrationError(error: unknown): {
  message: string;
  status: number;
} {
  if (error instanceof SourceRegistryError) {
    return { message: error.message, status: error.status };
  }
  return {
    message:
      error instanceof Error ? error.message : "Source discovery failed.",
    status: 400,
  };
}

export async function POST(request: NextRequest) {
  try {
    assertDiscoveryRateLimit(requestIp(request));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  try {
    const body = (await request.json()) as { url?: unknown };
    const url = publisherUrl(body.url);
    const declaration = await discoverDeclaration(url);
    const registrations = discoveryRegistrations(
      declaration,
      url.toString(),
    ).slice(0, MAX_DISCOVERY_SOURCES);
    const registered: CreatorSource[] = [];

    for (const registration of registrations) {
      try {
        const result = await appendSource(registration);
        registered.push(publicSource(result.source));
      } catch (error) {
        const { message, status } = registrationError(error);
        if (registered.length === 0) {
          return NextResponse.json(
            { registered, count: 0, error: message, note: DISCOVERY_NOTE },
            { status },
          );
        }
        return NextResponse.json(
          {
            registered,
            count: registered.length,
            error: `Registered ${registered.length} of ${registrations.length} source(s), then stopped: ${message}`,
            note: DISCOVERY_NOTE,
          },
          { status: 201 },
        );
      }
    }

    return NextResponse.json(
      {
        registered,
        count: registered.length,
        note: DISCOVERY_NOTE,
      },
      { status: 201 },
    );
  } catch (error) {
    const { message, status } = registrationError(error);
    return NextResponse.json(
      { registered: [], count: 0, error: message, note: DISCOVERY_NOTE },
      { status },
    );
  }
}
