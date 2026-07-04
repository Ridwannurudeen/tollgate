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
const DISCOVERY_NOTE =
  "Discovered sources are registered as probationary until ownership is verified.";

function requestIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "local"
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

async function fetchTollgateJson(
  url: URL,
): Promise<TollgateDeclaration | null> {
  const declarationUrl = new URL("/.well-known/tollgate.json", url);
  const response = await safeFetch(declarationUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  try {
    return parseTollgateJson(await response.json(), url.toString());
  } catch {
    return null;
  }
}

async function fetchTollgateMeta(
  url: URL,
): Promise<TollgateDeclaration | null> {
  const response = await safeFetch(url, {
    headers: { accept: "text/html, application/xhtml+xml" },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  return parseTollgateMeta(await response.text(), url.toString());
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
