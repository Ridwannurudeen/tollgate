import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig, type SidecarConfig } from "./config.js";
import { createFeeRouterAdapter } from "./fee-router.js";
import { normalizeJellyfinEvent, processJellyfinWebhook } from "./jellyfin.js";
import {
  authenticateJellyfinOperator,
  JellyfinOperatorRegistrationError,
  registerJellyfinOperator,
} from "./operators.js";
import { buildHealth, buildProofPack } from "./proof.js";
import type { JellyfinWebhookPayload } from "./types.js";

const MAX_BODY_BYTES = 1_048_576;
const REGISTRATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_REGISTRATIONS_PER_WINDOW = 20;
const registrationBuckets = new Map<string, { count: number; resetAt: number }>();

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error("request body is too large");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody(body: string): JellyfinWebhookPayload {
  const parsed = JSON.parse(body) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("expected a JSON object");
  }
  return parsed as JellyfinWebhookPayload;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  return value?.trim() || null;
}

function requestIp(request: IncomingMessage): string {
  const realIp = headerValue(request.headers["x-real-ip"]);
  if (realIp) return realIp;
  const forwarded = headerValue(request.headers["x-forwarded-for"]);
  if (forwarded) return forwarded.split(",")[0]?.trim() || "local";
  return request.socket.remoteAddress ?? "local";
}

function assertRegistrationRateLimit(ip: string, now = Date.now()): void {
  const bucket = registrationBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    registrationBuckets.set(ip, {
      count: 1,
      resetAt: now + REGISTRATION_WINDOW_MS,
    });
    return;
  }
  if (bucket.count >= MAX_REGISTRATIONS_PER_WINDOW) {
    throw new JellyfinOperatorRegistrationError(
      "Too many Jellyfin registrations.",
      429,
    );
  }
  bucket.count += 1;
}

function apiKeyFromRequest(request: IncomingMessage): string | null {
  const explicit = headerValue(request.headers["x-tollgate-key"]);
  if (explicit) return explicit;
  const authorization = headerValue(request.headers.authorization);
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }
  return null;
}

export function createSidecarServer(config: SidecarConfig = loadConfig()) {
  const feeRouter = createFeeRouterAdapter(config);

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, await buildHealth(config));
        return;
      }

      if (request.method === "GET" && url.pathname === "/proof") {
        sendJson(response, 200, await buildProofPack(config));
        return;
      }

      if (request.method === "POST" && url.pathname === "/operators/register") {
        assertRegistrationRateLimit(requestIp(request));
        const result = await registerJellyfinOperator(
          JSON.parse(await readBody(request)) as unknown,
          {
            operatorsPath: config.operatorsPath,
            registryPath: config.registryPath,
          },
        );
        sendJson(response, 201, {
          ...result,
          webhookUrl: config.publicWebhookUrl,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/webhooks/jellyfin") {
        const operator = await authenticateJellyfinOperator(
          apiKeyFromRequest(request),
          config.operatorsPath,
        );
        if (!operator) {
          sendJson(response, 401, {
            error: "missing or invalid X-Tollgate-Key",
          });
          return;
        }
        const payload = parseJsonBody(await readBody(request));
        const event = normalizeJellyfinEvent(payload);
        if (event && !operator.itemIds.includes(event.itemId)) {
          sendJson(response, 403, {
            error: "Jellyfin item is not registered for this API key.",
          });
          return;
        }
        const result = await processJellyfinWebhook(payload, {
          registryPath: config.registryPath,
          ledgerPath: config.ledgerPath,
          sessionsPath: config.sessionsPath,
          defaultAtomicUsdcPerMinute: config.defaultAtomicUsdcPerMinute,
          feeRouter,
        });
        const status =
          result.kind === "ignored" || result.kind === "unresolved" ? 202 : 200;
        sendJson(response, status, result);
        return;
      }

      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof JellyfinOperatorRegistrationError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      sendJson(response, 400, {
        error: error instanceof Error ? error.message : "unknown error",
      });
    }
  });
}

export function startServer(config: SidecarConfig = loadConfig()): void {
  const server = createSidecarServer(config);
  server.listen(config.port, () => {
    process.stdout.write(
      `jellyfin-sidecar listening on http://127.0.0.1:${config.port}\n`,
    );
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer();
}
