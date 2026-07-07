# Tollgate WordPress Plugin

Thin WordPress client for Tollgate pay-per-read posts.

The plugin never signs transactions and never stores private keys. It gates selected posts in WordPress, detects AI crawler user agents with a real HTTP 402 response, and calls Tollgate's hosted `/api/wordpress/*` settlement API. FeeRouter settlement and hash-chained receipts stay in the existing Node/viem Tollgate app.

## Install

1. Copy `tollgate.php` into `wp-content/plugins/tollgate/tollgate.php`.
2. Activate "Tollgate Pay-Per-Read" in WordPress.
3. Register the site with the Tollgate hosted API and paste the returned site API key under Settings -> Tollgate.
4. Open a post, enable "Gate this post with Tollgate", and set a price in atomic USDC.

## Local Checks

Static checks:

```bash
npm test
```

Docker-backed WordPress/PHP/MySQL runtime smoke test:

```bash
npm run wp:test-env
```

This uses WordPress's `@wordpress/env` tool and requires Docker to be installed and running. The lockfile currently resolves `@wordpress/env` to `11.10.0`. The `.wp-env.json` config mounts this plugin with `plugins: [ "." ]` on port `8897`.

The check starts `wp-env`, activates the mounted plugin through WP-CLI, configures a local mock Tollgate API, logs into wp-admin, renders Settings -> Tollgate, opens the seeded post editor, saves the Tollgate meta box, verifies the saved post meta, and POSTs the plugin REST pay route at `/wp-json/tollgate/v1/pay/:id`. It does not call the live hosted Tollgate API.

Docker-free Playground smoke test:

```bash
npm run wp:smoke
```

The Playground smoke test uses `@wp-playground/cli`, which runs WordPress through PHP-WASM from Node. It does not require local PHP, Docker, MySQL, or Apache, so it remains the runnable local WordPress runtime check when Docker is unavailable. The test auto-mounts and activates this plugin, seeds a gated post, uses a local mock Tollgate API, then verifies the archive page does not leak gated content, the human paywall, AI-agent HTTP 402 response, and plugin REST pay route.

Manual hosted-API end-to-end check:

1. Run `npm run wp:test-env` once on a machine with Docker to verify the plugin activates and the wp-admin/REST cycle works in a disposable WordPress install.
2. Start the environment with `npx wp-env start`.
3. Register the local site with the hosted Tollgate API and paste the returned site API key under Settings -> Tollgate. Do not commit the key.
4. Open a gated post, use the pay button, and verify the hosted API records the settlement/receipt.

Manual local WordPress server:

```bash
npm run wp:server
```

This starts a WordPress Playground server with the plugin auto-mounted and activated. Open the printed local URL in a browser.

The manual server seeds a gated post at `http://127.0.0.1:9417/hello-tollgate/` and points the plugin at `http://127.0.0.1:3091` for the hosted Tollgate API. In WordPress Playground, the query-form singular route `http://127.0.0.1:9417/?p=4` is the reliable URL for testing the AI-agent HTTP 402 branch. Start the citations app separately if you want the pay button to call a live local API.
