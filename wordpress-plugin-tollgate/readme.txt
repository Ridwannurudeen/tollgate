=== Tollgate Pay-Per-Read ===
Contributors: tollgate
Tags: paywall, x402, usdc, ai, crawler
Requires at least: 6.0
Tested up to: 6.6
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPL-2.0-or-later

Gate selected WordPress posts and verify Tollgate payment receipts.

== Description ==

Tollgate Pay-Per-Read is a thin WordPress client. It gates selected posts, returns HTTP 402 JSON to known AI crawler user agents, and checks Tollgate's hosted API for existing payment receipts. Its public callback cannot initiate operator-funded settlement without reader payment authorization.

The plugin does not contain wallet signing code, private keys, or FeeRouter contract calls. All settlement logic stays in Tollgate's Node/viem app.

== Installation ==

1. Upload `tollgate.php` to `wp-content/plugins/tollgate/`.
2. Activate the plugin.
3. Ask the Tollgate operator to register the site URL, payout wallet, and price, then paste the returned site API key under Settings -> Tollgate.
4. Enable Tollgate on individual posts from the editor metabox.

== Changelog ==

= 0.1.0 =
Initial direct-install package.
