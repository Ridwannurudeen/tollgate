# Recipe: putting a payment gate in front of software that has none

Immich has no concept of paid downloads and was never going to grow one for us. The gate works anyway, because the reverse proxy in front of it can ask a second service "is this request licensed?" before it forwards anything. That question is the whole pattern, and nothing about it is specific to Immich, to nginx, or to Tollgate.

This document is the contract. Three implementations follow it, at three different levels of proof.

| Implementation | File | Status |
| --- | --- | --- |
| nginx | `aperture/deploy/nginx/tollgate-aperture.locations.conf` | **Running in production** |
| Cloudflare Worker | `aperture/deploy/cloudflare/tollgate-gate.worker.mjs` | Unit-tested, not yet deployed |
| Caddy | `aperture/deploy/caddy/tollgate-aperture.Caddyfile` | **Written from docs, never executed** |

## The contract

**1. The gate covers one exact path.** Everything else proxies normally. In Aperture that path is the shared-link archive download; the browsing UI, the API, and the app itself stay open, because the thing being sold is the file, not the site.

**2. The check is a GET subrequest with no body.** It carries the original request's identity, not its payload:

| Header | Value |
| --- | --- |
| `X-Original-URI` | original path **and query string** |
| `X-Original-Method` | original method |
| `X-Original-<credential>` | any credential header the client sent, prefixed |

The query string is not optional — the current check decides on the presence of `?key=` or `?slug=`, so a gate that forwards only the path allows every download.

**3. A credential header is only forwarded when the client actually sent one.** The check treats presence as evidence of a shared link. Send an empty header and every owner-session download is denied. nginx gets this free (it omits empty headers); the Worker does it explicitly; any new implementation has to.

**4. 2xx allows, 401/403 denies.** The current check answers `204` or `403`. Nothing else is a decision.

**5. A denial becomes `402`, not a passthrough.** The proxy rewrites it, with `Content-Type: application/json` and a body naming where to pay:

```json
{ "error": "payment required", "pay": "/aperture/api/license-download" }
```

This is the step every port gets wrong. nginx needs it because `auth_request` only understands 401/403, so the check cannot simply answer 402 itself. Caddy needs it because `forward_auth` copies the check's response verbatim. The x402 client is looking for 402 — a 403 reads as "forbidden, don't bother", not "pay and retry".

**6. On allow, strip the credential before forwarding upstream.** nginx blanks `X-Immich-Share-Key` and `X-Immich-Share-Slug`; the Worker deletes them. Skip this and the origin happily serves the file on the strength of the shared link, which is the exact thing being charged for. The gate would appear to work while collecting nothing.

**7. Fail closed.** An unreachable or unexpected check result denies. Availability of the payment service is not a reason to give away the file.

**8. Don't buffer the response.** These are archive downloads. nginx uses `proxy_buffering off`, Caddy `flush_interval -1`.

## What is Aperture-specific, and what isn't

Aperture-specific: the credential header names, the `?key=`/`?slug=` convention, the pay path, and the upstream being Immich on `127.0.0.1:2283`.

Everything else — subrequest carries the original URI, 2xx/403 decision, rewrite to 402 with a pay link, strip the credential, fail closed, stream — is the portable part. Point steps 2 and 6 at your own credential and you have gated different software.

## Porting notes

- **The check must not be reachable from outside.** nginx marks it `internal`. A public license-check endpoint is only an information leak here rather than a bypass, since the gate decides, but there is no reason to expose it.
- **The subrequest costs a round trip per download.** Both live on the same host today, so it is cheap; a Worker calling a distant origin is not, and the check is a good candidate for edge caching keyed on the credential — deliberately not done yet.
- **Aperture's own x402 route is separate.** `/aperture/api/license-archive` is the server-controlled paid path. This gate exists for the *legacy* Immich shared-link route, where the download URL is one the origin already understands and we cannot change.
