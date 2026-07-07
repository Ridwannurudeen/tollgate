import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const wpEnvBin = path.join(
  pluginDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "wp-env.cmd" : "wp-env",
);
const dockerBin = process.platform === "win32" ? "docker.exe" : "docker";
const wpEnvPort = process.env.WP_ENV_PORT || "8897";
const baseUrl = `http://localhost:${wpEnvPort}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: pluginDir,
    encoding: "utf8",
    windowsHide: true,
    ...options,
    env: {
      ...process.env,
      WP_ENV_PORT: wpEnvPort,
      ...(options.env || {}),
    },
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${args.join(" ")} failed with exit code ${result.status}`,
        result.stdout,
        result.stderr,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

function requireDocker() {
  let version;
  let serverVersion;
  try {
    version = run(dockerBin, ["--version"]);
    serverVersion = run(dockerBin, ["info", "--format", "{{.ServerVersion}}"]);
  } catch (error) {
    throw new Error(
      `wp-env uses Docker for this real WordPress runtime check. Docker is not available or its daemon is not running: ${error.message}`,
    );
  }
  console.log(`Docker available: ${version}; server ${serverVersion}`);
}

function wpEnv(args) {
  return run(wpEnvBin, args);
}

function wp(args) {
  return wpEnv(["run", "cli", "--", "wp", ...args]);
}

async function mockTollgateApi() {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyRaw = Buffer.concat(chunks).toString("utf8");
    requests.push({
      method: request.method,
      url: request.url,
      siteKey: request.headers["x-tollgate-site-key"],
      body: bodyRaw ? JSON.parse(bodyRaw) : {},
    });

    response.setHeader("content-type", "application/json");
    if (request.url?.endsWith("/status")) {
      response.end(JSON.stringify({ paid: false }));
      return;
    }
    if (request.url?.endsWith("/pay")) {
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          paid: true,
          receiptHash: `0x${"b".repeat(64)}`,
          settlementMode: "wp-env-mock",
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
    baseUrl: `http://host.docker.internal:${address.port}`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function waitForHttp(url) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 120_000) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for ${url}: ${lastError?.message || "unknown error"}`,
  );
}

class CookieJar {
  cookies = new Map();

  store(response) {
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [response.headers.get("set-cookie")].filter(Boolean);
    for (const cookie of setCookies) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) {
        this.cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
  }

  header() {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join(
      "; ",
    );
  }

  async fetch(url, options = {}) {
    const headers = new Headers(options.headers || {});
    const cookie = this.header();
    if (cookie) headers.set("cookie", cookie);
    const response = await fetch(url, { ...options, headers });
    this.store(response);
    return response;
  }
}

async function login() {
  const jar = new CookieJar();
  await jar.fetch(`${baseUrl}/wp-login.php`);
  const body = new URLSearchParams({
    log: "admin",
    pwd: "password",
    "wp-submit": "Log In",
    redirect_to: `${baseUrl}/wp-admin/`,
    testcookie: "1",
  });
  const response = await jar.fetch(`${baseUrl}/wp-login.php`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  assert.equal(response.status, 302);

  const dashboard = await jar.fetch(`${baseUrl}/wp-admin/`);
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Dashboard/);
  return jar;
}

function inputValue(html, name) {
  const inputs = html.match(/<input\b[^>]*>/gi) || [];
  const tag = inputs.find((input) => {
    const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\bname=["']${quoted}["']`).test(input);
  });
  assert(tag, `Missing input named ${name}`);
  const value = tag.match(/\bvalue=(["'])(.*?)\1/);
  assert(value, `Missing value for input named ${name}`);
  return value[2];
}

function createPost() {
  const output = wp([
    "eval",
    `
$existing = get_page_by_path('tollgate-wp-env-smoke', OBJECT, 'post');
if ($existing) {
    $post_id = $existing->ID;
    wp_update_post(array(
        'ID' => $post_id,
        'post_title' => 'Tollgate WP Env Smoke',
        'post_content' => 'This content must stay behind the wp-env paywall.',
        'post_status' => 'publish',
    ));
} else {
    $post_id = wp_insert_post(array(
        'post_title' => 'Tollgate WP Env Smoke',
        'post_name' => 'tollgate-wp-env-smoke',
        'post_status' => 'publish',
        'post_type' => 'post',
        'post_content' => 'This content must stay behind the wp-env paywall.',
    ));
}
if (is_wp_error($post_id)) {
    throw new Exception($post_id->get_error_message());
}
delete_post_meta($post_id, '_tollgate_gated');
delete_post_meta($post_id, '_tollgate_price_atomic_usdc');
echo 'TOLLGATE_POST_ID=' . $post_id;
`,
  ]);
  const postId = output.match(/TOLLGATE_POST_ID=(\d+)/)?.[1];
  assert(postId, `Could not parse seeded post ID from wp-env output: ${output}`);
  assert.match(postId, /^\d+$/);
  return postId;
}

function configurePlugin(apiBase) {
  wp([
    "eval",
    `
update_option('tollgate_options', array(
    'api_base' => '${apiBase}',
    'site_key' => 'test-site-key',
    'creator_wallet' => '0x7777777777777777777777777777777777777777',
    'default_price_atomic_usdc' => 2500,
));
`,
  ]);
}

function activatePlugin() {
  const names = wp(["plugin", "list", "--field=name"])
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
  const pluginName =
    names.find((name) => name === "wordpress-plugin-tollgate") ||
    names.find((name) => name === "tollgate") ||
    names.find((name) => name.includes("tollgate"));
  assert(pluginName, `Tollgate plugin not found. Installed plugins: ${names}`);
  wp(["plugin", "activate", pluginName]);
  return pluginName;
}

async function saveGateMetaBox(jar, postId) {
  const editResponse = await jar.fetch(
    `${baseUrl}/wp-admin/post.php?post=${postId}&action=edit`,
  );
  assert.equal(editResponse.status, 200);
  const editHtml = await editResponse.text();
  assert.match(editHtml, /Gate this post with Tollgate/);
  assert.match(editHtml, /name="tollgate_price_atomic_usdc"/);

  const body = new URLSearchParams({
    _wpnonce: inputValue(editHtml, "_wpnonce"),
    _wp_http_referer: `/wp-admin/post.php?post=${postId}&action=edit`,
    user_ID: "1",
    action: "editpost",
    originalaction: "editpost",
    post_author: "1",
    post_type: "post",
    post_ID: postId,
    original_post_status: "publish",
    post_status: "publish",
    post_title: "Tollgate WP Env Smoke",
    content: "This content must stay behind the wp-env paywall.",
    comment_status: "closed",
    ping_status: "closed",
    tollgate_gate_nonce: inputValue(editHtml, "tollgate_gate_nonce"),
    tollgate_gated: "1",
    tollgate_price_atomic_usdc: "2500",
    save: "Update",
  });
  const saveResponse = await jar.fetch(`${baseUrl}/wp-admin/post.php`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      referer: `${baseUrl}/wp-admin/post.php?post=${postId}&action=edit`,
    },
    body,
  });
  assert([200, 302].includes(saveResponse.status));

  const metaOutput = wp([
    "eval",
    `
echo 'TOLLGATE_GATED=' . get_post_meta(${postId}, '_tollgate_gated', true) . "\\n";
echo 'TOLLGATE_PRICE=' . get_post_meta(${postId}, '_tollgate_price_atomic_usdc', true);
`,
  ]);
  assert.match(metaOutput, /TOLLGATE_GATED=1/);
  assert.match(metaOutput, /TOLLGATE_PRICE=2500/);
}

async function main() {
  requireDocker();
  const api = await mockTollgateApi();
  let started = false;

  try {
    started = true;
    wpEnv(["start", "--update"]);
    await waitForHttp(baseUrl);

    const pluginName = activatePlugin();
    configurePlugin(api.baseUrl);
    const postId = createPost();
    const jar = await login();

    const settingsResponse = await jar.fetch(
      `${baseUrl}/wp-admin/options-general.php?page=tollgate`,
    );
    assert.equal(settingsResponse.status, 200);
    const settingsHtml = await settingsResponse.text();
    assert.match(settingsHtml, /Tollgate Pay-Per-Read/);
    assert.match(settingsHtml, /name="tollgate_options\[api_base\]"/);

    await saveGateMetaBox(jar, postId);

    const payResponse = await fetch(
      `${baseUrl}/wp-json/tollgate/v1/pay/${postId}`,
      { method: "POST" },
    );
    assert.equal(payResponse.status, 200);
    const payBody = await payResponse.json();
    assert.equal(payBody.paid, true);
    assert.equal(payBody.settlementMode, "wp-env-mock");

    const payCalls = api.requests.filter((request) =>
      request.url?.endsWith("/pay"),
    );
    assert.equal(payCalls.length, 1);
    assert.equal(payCalls[0].siteKey, "test-site-key");
    assert.equal(payCalls[0].body.priceAtomicUsdc, 2500);

    console.log(
      `wp-env smoke passed for ${pluginName} at ${baseUrl} using mock API ${api.baseUrl}`,
    );
  } finally {
    if (started) {
      try {
        wpEnv(["stop"]);
      } catch (error) {
        console.warn(`wp-env stop failed during cleanup: ${error.message}`);
      }
    }
    await api.close();
  }
}

await main();
