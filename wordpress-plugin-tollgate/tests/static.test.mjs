import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const plugin = await readFile(new URL("../tollgate.php", import.meta.url), "utf8");

describe("Tollgate WordPress plugin", () => {
  it("uses the standard WordPress hooks for settings, metaboxes, gating, and REST payment", () => {
    assert.match(plugin, /Plugin Name:\s*Tollgate Pay-Per-Read/);
    assert.match(plugin, /register_setting\('tollgate_settings'/);
    assert.match(plugin, /add_meta_box\(/);
    assert.match(plugin, /add_filter\('the_content', 'tollgate_gate_content'\)/);
    assert.match(plugin, /add_action\('template_redirect', 'tollgate_agent_payment_required'/);
    assert.match(plugin, /register_rest_route\('tollgate\/v1'/);
    assert.match(plugin, /\/pay\/\(\?P<post_id>\\d\+\)/);
  });

  it("calls the hosted Tollgate WordPress API through the WordPress HTTP API", () => {
    assert.match(plugin, /wp_remote_post\(/);
    assert.match(plugin, /X-Tollgate-Site-Key/);
    assert.match(plugin, /\/api\/wordpress\/posts\//);
    assert.match(plugin, /\/api\/wordpress\/proof/);
    assert.doesNotMatch(plugin, /curl_exec|file_get_contents|shell_exec|proc_open|popen/);
  });

  it("returns a real HTTP 402 for known AI agent user agents", () => {
    assert.match(plugin, /status_header\(402\)/);
    for (const agent of [
      "GPTBot",
      "ClaudeBot",
      "Google-Extended",
      "PerplexityBot",
      "CCBot",
      "Bytespider",
      "Applebot-Extended",
      "Meta-ExternalAgent",
    ]) {
      assert.match(plugin, new RegExp(agent));
    }
  });

  it("does not embed wallet signing or private-key logic in PHP", () => {
    assert.doesNotMatch(plugin, /viem|ethers|web3\.php|PRIVATE_KEY|privateKey|mnemonic|seed phrase/i);
    assert.doesNotMatch(plugin, /signTypedData|writeContract|FeeRouterV1\.pay/i);
  });
});
