import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { loadConfig, type SidecarConfig } from "./config.js";
import { createFeeRouterAdapter } from "./fee-router.js";
import { processJellyfinWebhook } from "./jellyfin.js";
import { buildHealth, buildProofPack } from "./proof.js";
import type { JellyfinWebhookPayload } from "./types.js";

const MAX_BODY_BYTES = 1_048_576;

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

export function createSidecarServer(config: SidecarConfig = loadConfig()) {
  const feeRouter = createFeeRouterAdapter(config.feeRouterMode);

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

      if (request.method === "POST" && url.pathname === "/webhooks/jellyfin") {
        const result = await processJellyfinWebhook(parseJsonBody(await readBody(request)), {
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
