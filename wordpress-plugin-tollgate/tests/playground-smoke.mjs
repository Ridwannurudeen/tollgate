import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const cliEntry = path.join(
  pluginDir,
  "node_modules",
  "@wp-playground",
  "cli",
  "wp-playground.js",
);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  assert(address && typeof address === "object");
  return address.port;
}

async function mockTollgateApi() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyRaw = Buffer.concat(chunks).toString("utf8");
    const body = bodyRaw ? JSON.parse(bodyRaw) : {};
    requests.push({
      method: request.method,
      url: request.url,
      siteKey: request.headers["x-tollgate-site-key"],
      body,
    });

    response.setHeader("content-type", "application/json");
    if (request.url?.endsWith("/status")) {
      response.end(
        JSON.stringify({
          paid: false,
          eventId: "wordpress:mock:hello-tollgate:reader",
          receiptHash: null,
          settlementMode: null,
        }),
      );
      return;
    }
    if (request.url?.endsWith("/pay")) {
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          paid: true,
          created: true,
          eventId: "wordpress:mock:hello-tollgate:reader",
          queryId: "wordpress:mock:hello-tollgate:reader",
          receiptHash: `0x${"a".repeat(64)}`,
          settlementMode: "forum-routed",
          amountAtomicUsdc: 2500,
        }),
      );
      return;
    }
    if (request.url === "/api/wordpress/proof") {
      response.end(JSON.stringify({ project: "tollgate-wordpress" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function blueprint(apiBase) {
  return {
    steps: [
      {
        step: "activatePlugin",
        pluginPath: "wordpress-plugin-tollgate/tollgate.php",
      },
      {
        step: "runPHP",
        code: {
          filename: "seed-tollgate-post.php",
          content: `<?php
require_once '/wordpress/wp-load.php';

update_option('tollgate_options', array(
    'api_base' => '${apiBase}',
    'site_key' => 'test-site-key',
    'creator_wallet' => '0x7777777777777777777777777777777777777777',
    'default_price_atomic_usdc' => 2500,
));
update_option('permalink_structure', '/%postname%/');

$existing = get_page_by_path('hello-tollgate', OBJECT, 'post');
if ($existing) {
    $post_id = $existing->ID;
} else {
    $post_id = wp_insert_post(array(
        'post_title' => 'Hello Tollgate',
        'post_name' => 'hello-tollgate',
        'post_status' => 'publish',
        'post_type' => 'post',
        'post_content' => 'This content must stay behind the Tollgate paywall.',
    ));
}
if (is_wp_error($post_id)) {
    throw new Exception($post_id->get_error_message());
}
update_post_meta($post_id, '_tollgate_gated', '1');
update_post_meta($post_id, '_tollgate_price_atomic_usdc', '2500');
flush_rewrite_rules(false);
`,
        },
      },
    ],
  };
}

// Playground boots its PHP workers asynchronously and prints
// "Ready! WordPress is running on ..." once they can serve requests. Probing
// the HTTP server before that line appears sends requests into a
// still-initializing worker pool, which faults the CLI's internal
// request-router ("Error: fetch failed") and can crash the whole process.
// Wait for the readiness line (or the process to die) before any HTTP probe.
async function waitForReadyLine(processHandle, logs) {
  const started = Date.now();
  while (Date.now() - started < 240_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Playground exited before printing its readiness line.\n${logs
          .slice(-80)
          .join("")}`,
      );
    }
    if (/Ready! WordPress is running/i.test(logs.join(""))) {
      // Small grace so the just-started workers settle before the first probe.
      await delay(1500);
      return;
    }
    await delay(500);
  }
  throw new Error(
    `Timed out waiting for Playground readiness line.\n${logs.slice(-80).join("")}`,
  );
}

async function waitForJson(url, processHandle, logs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 240_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Playground exited before it was ready.\n${logs.slice(-80).join("")}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError?.message ?? "unknown"}\n${logs
      .slice(-80)
      .join("")}`,
  );
}

async function waitForTollgateNamespace(baseUrl, processHandle, logs) {
  const started = Date.now();
  let lastNamespaces = [];
  let lastError = null;
  while (Date.now() - started < 240_000) {
    try {
      const restIndex = await waitForJson(
        `${baseUrl}/wp-json/`,
        processHandle,
        logs,
      );
      lastNamespaces = Array.isArray(restIndex.namespaces)
        ? restIndex.namespaces
        : [];
      if (lastNamespaces.includes("tollgate/v1")) return;
      lastError = new Error(`namespaces: ${JSON.stringify(lastNamespaces)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw new Error(
    `Timed out waiting for Tollgate REST namespace: ${lastError?.message ?? "unknown"}\n${logs
      .slice(-80)
      .join("")}`,
  );
}

async function waitForSeededPost(baseUrl, processHandle, logs) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 240_000) {
    if (processHandle.exitCode !== null) {
      throw new Error(
        `Playground exited before the seeded post was ready.\n${logs.slice(-80).join("")}`,
      );
    }
    try {
      const response = await fetch(
        `${baseUrl}/wp-json/wp/v2/posts?slug=hello-tollgate`,
      );
      if (response.ok) {
        const posts = await response.json();
        if (Array.isArray(posts) && posts.length === 1) return posts[0];
        lastError = new Error(`found ${Array.isArray(posts) ? posts.length : "non-array"} posts`);
      } else {
        lastError = new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      lastError = error;
    }
    await delay(1000);
  }
  throw new Error(
    `Timed out waiting for seeded post: ${lastError?.message ?? "unknown"}\n${logs
      .slice(-80)
      .join("")}`,
  );
}

// The Playground CLI downloads the WordPress/PHP WASM assets on boot. When
// that network fetch hiccups the CLI dies with "Error: fetch failed" before it
// ever prints its readiness line. A successful attempt warms the on-disk asset
// cache, so retrying the whole spawn recovers reliably (and boots fast once
// cached). Retry boot up to `attempts` times before giving up.
async function bootReadyPlayground(port, baseUrl, blueprintPath, logs) {
  const attempts = 3;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const playground = spawn(
      process.execPath,
      [
        cliEntry,
        "server",
        `--auto-mount=${pluginDir}`,
        `--blueprint=${blueprintPath}`,
        "--php=8.3",
        "--wp=latest",
        "--no-intl",
        "--no-redis",
        "--no-memcached",
        `--port=${port}`,
        `--site-url=${baseUrl}`,
        "--workers=6",
      ],
      { cwd: pluginDir, windowsHide: true },
    );
    playground.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
    playground.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

    try {
      await waitForReadyLine(playground, logs);
      return playground;
    } catch (error) {
      lastError = error;
      if (playground.exitCode === null) playground.kill();
      if (attempt < attempts) {
        logs.length = 0;
        await delay(2000);
      }
    }
  }
  throw lastError ?? new Error("Playground failed to boot.");
}

async function main() {
  const api = await mockTollgateApi();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const tmp = await mkdtemp(path.join(tmpdir(), "tollgate-playground-"));
  const blueprintPath = path.join(tmp, "blueprint.json");
  const logs = [];
  let playground;

  try {
    await writeFile(
      blueprintPath,
      `${JSON.stringify(blueprint(api.baseUrl), null, 2)}\n`,
      "utf8",
    );

    playground = await bootReadyPlayground(port, baseUrl, blueprintPath, logs);
    await waitForTollgateNamespace(baseUrl, playground, logs);

    const post = await waitForSeededPost(baseUrl, playground, logs);

    const indexResponse = await fetch(baseUrl);
    assert.equal(indexResponse.status, 200);
    const indexHtml = await indexResponse.text();
    assert.match(indexHtml, /This post is gated by Tollgate/);
    assert.doesNotMatch(indexHtml, /This content must stay behind/);

    const humanResponse = await fetch(post.link);
    assert.equal(humanResponse.status, 200);
    const humanHtml = await humanResponse.text();
    assert.match(humanHtml, /This post is gated by Tollgate/);
    assert.match(humanHtml, /Unlock with Tollgate/);
    assert.doesNotMatch(humanHtml, /This content must stay behind/);

    const agentResponse = await fetch(`${baseUrl}/?p=${post.id}`, {
      headers: { "User-Agent": "GPTBot/1.0" },
    });
    assert.equal(agentResponse.status, 402);
    const agentBody = await agentResponse.json();
    assert.equal(agentBody.error, "payment_required");
    assert.equal(agentBody.paymentRequirements.amountAtomicUsdc, 2500);
    assert.equal(
      agentBody.paymentRequirements.proofEndpoint,
      `${api.baseUrl}/api/wordpress/proof`,
    );

    const payResponse = await fetch(
      `${baseUrl}/wp-json/tollgate/v1/pay/${post.id}`,
      { method: "POST" },
    );
    assert.equal(payResponse.status, 200);
    const payBody = await payResponse.json();
    assert.equal(payBody.paid, true);
    assert.equal(payBody.settlementMode, "forum-routed");

    const statusCalls = api.requests.filter((request) =>
      request.url?.endsWith("/status"),
    );
    const payCalls = api.requests.filter((request) =>
      request.url?.endsWith("/pay"),
    );
    assert(statusCalls.length >= 2);
    assert.equal(payCalls.length, 1);
    assert.equal(payCalls[0].siteKey, "test-site-key");
    assert.equal(payCalls[0].body.priceAtomicUsdc, 2500);

    console.log(`WordPress Playground smoke passed at ${baseUrl}`);
  } finally {
    if (playground && playground.exitCode === null) {
      playground.kill();
    }
    await api.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

await main();
