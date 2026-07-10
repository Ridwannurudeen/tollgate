import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFeeRouterPublicClient,
  createFeeRouterSigner,
  ensureCreatorSplit,
  payViaSplit,
} from "@tollgate/pay-per-piece";
import { createFileSplitRegistryStore } from "@tollgate/pay-per-piece/stores/file";

const ARTICLE_PRICE_ATOMIC_USDC = 1_000n;
const SERVER_FILE = fileURLToPath(import.meta.url);
const SERVER_DIRECTORY = path.dirname(SERVER_FILE);
const ARTICLE = `
  <article>
    <p class="eyebrow">Payment confirmed</p>
    <h1>The smallest useful payment rail</h1>
    <p>A per-piece market works when settlement is cheaper than the decision to subscribe.</p>
    <p>This article was released only after the FeeRouter transaction succeeded and emitted the expected Routed event.</p>
  </article>
`;

function requiredPrivateKey() {
  const privateKey = process.env.TOY_PAYWALL_PRIVATE_KEY;
  if (!privateKey || !/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
    throw new Error("TOY_PAYWALL_PRIVATE_KEY must be a 32-byte hex key.");
  }
  return privateKey;
}

function requiredRecipient() {
  const recipient = process.env.TOY_PAYWALL_RECIPIENT_ADDRESS;
  if (!recipient || !/^0x[a-fA-F0-9]{40}$/.test(recipient)) {
    throw new Error("TOY_PAYWALL_RECIPIENT_ADDRESS must be an EVM address.");
  }
  return recipient;
}

async function unlockArticle() {
  const rpcUrl =
    process.env.TOY_PAYWALL_RPC_URL ?? "https://rpc.testnet.arc.network";
  const signer = createFeeRouterSigner(requiredPrivateKey(), { rpcUrl });
  const recipient = requiredRecipient();
  const publicClient = createFeeRouterPublicClient(rpcUrl);
  const registryPath = path.resolve(
    process.env.TOY_PAYWALL_REGISTRY_PATH ??
      path.join(SERVER_DIRECTORY, "data", "fee-router-splits.json"),
  );
  const store = createFileSplitRegistryStore(registryPath);
  const split = await ensureCreatorSplit(
    store,
    "toy-paywall",
    recipient,
    [recipient],
    [10_000],
    signer,
    publicClient,
  );
  const { txHash } = await payViaSplit(
    signer,
    BigInt(split.splitId),
    ARTICLE_PRICE_ATOMIC_USDC,
    publicClient,
  );
  return { splitId: split.splitId, txHash };
}

function page(body) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Toy pay-per-piece article</title>
    <style>
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0d10; color: #f5f2e9; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(42rem, calc(100% - 3rem)); padding: 4rem 0; }
      .eyebrow { color: #8de6c1; font-size: .75rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
      h1 { font-family: Georgia, serif; font-size: clamp(2.5rem, 8vw, 5rem); line-height: .95; margin: .75rem 0 2rem; }
      p { color: #c9c4b8; font-size: 1.1rem; line-height: 1.7; }
      button { border: 0; border-radius: 999px; background: #8de6c1; color: #08120d; cursor: pointer; font: inherit; font-weight: 800; padding: .9rem 1.3rem; }
      code { color: #8de6c1; overflow-wrap: anywhere; }
    </style>
  </head>
  <body><main>${body}</main></body>
</html>`;
}

function writeHtml(response, status, body, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "text/html; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(page(body));
}

export function createToyPaywallServer(options = {}) {
  const settle = options.settle ?? unlockArticle;
  let settled;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      writeHtml(
        response,
        200,
        `<p class="eyebrow">1,000 atomic testnet USDC</p>
         <h1>One article. One payment.</h1>
         <p>The full article is released only after a confirmed FeeRouter payment.</p>
         <form method="post" action="/unlock"><button type="submit">Pay and unlock</button></form>`,
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/unlock") {
      const serverAddress = server.address();
      const allowedHost =
        serverAddress && typeof serverAddress !== "string"
          ? `127.0.0.1:${serverAddress.port}`
          : null;
      const origin = request.headers.origin;
      if (
        !allowedHost ||
        request.headers.host !== allowedHost ||
        (origin && origin !== `http://${allowedHost}`)
      ) {
        writeHtml(
          response,
          403,
          `<p class="eyebrow">Forbidden</p><h1>Same-origin requests only.</h1>`,
        );
        return;
      }
      if (!settled) {
        settled = Promise.resolve().then(settle);
      }
      try {
        const result = await settled;
        writeHtml(
          response,
          200,
          `${ARTICLE}<p>Split <code>${result.splitId}</code></p><p>Transaction <code>${result.txHash}</code></p>`,
        );
      } catch (error) {
        console.error(
          "Toy paywall settlement failed:",
          error instanceof Error ? error.message : "Unknown error",
        );
        writeHtml(
          response,
          502,
          `<p class="eyebrow">Settlement failed</p><h1>Article remains locked.</h1><p>Check the chain state, then restart the local server before retrying.</p>`,
        );
      }
      return;
    }

    if (url.pathname === "/unlock") {
      writeHtml(
        response,
        405,
        `<p class="eyebrow">Method not allowed</p><h1>Use POST to unlock.</h1>`,
        { allow: "POST" },
      );
      return;
    }

    writeHtml(response, 404, "<h1>Not found</h1>");
  });

  return server;
}

function configuredPort() {
  const raw = process.env.TOY_PAYWALL_PORT ?? "3402";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("TOY_PAYWALL_PORT must be an integer from 1 to 65535.");
  }
  return port;
}

if (process.argv[1] && SERVER_FILE === path.resolve(process.argv[1])) {
  const port = configuredPort();
  createToyPaywallServer().listen(port, "127.0.0.1", () => {
    console.log(`Toy paywall listening on http://127.0.0.1:${port}`);
  });
}
