# Aperture Deployment

## Current gates

- Public app path is `https://tollgate.gudman.xyz/aperture`; no new DNS is required for the dashboard.
- Paid archive downloads use Aperture's server-controlled `https://tollgate.gudman.xyz/aperture/api/license-archive` route. Direct shared-link archive requests to Immich remain gated.
- x402 requirements pay the approved creator directly. No collector or post-payment FeeRouter hop is part of the public request path.
- Both the Tollgate mount and optional standalone Immich vhost must keep the exact archive `auth_request` locations from this repo.

## VPS layout

- App directory: `/opt/aperture`
- Runtime environment: `/etc/aperture.env` with mode `600`
- Persistent runtime data: `/opt/aperture/data`, including the payment and one-use authorization SQLite journals
- Web service: `aperture.service` on `127.0.0.1:3036`
- Watcher service: `aperture-watcher.service`, reading `/var/log/nginx/access.log`
- Immich upstream: `http://127.0.0.1:2283`

## Runtime environment

```bash
APERTURE_IMMICH_API_BASE_URL=http://127.0.0.1:2283/api
APERTURE_BASE_PATH=/aperture
APERTURE_ACCESS_LOG=/var/log/nginx/access.log
APERTURE_LICENSE_FEE_ATOMIC_USDC=2500
APERTURE_GATEWAY_ENABLED=0
APERTURE_SESSION_SECRET=<openssl rand -hex 32>
```

With no supported x402 facilitator configured, paid routes fail closed with
HTTP 503 and do not load full media or record creator earnings.

## Commands

```bash
apt-get update
cd /opt/aperture
npm ci
npm run build
cp deploy/systemd/aperture.service /etc/systemd/system/aperture.service
cp deploy/systemd/aperture-watcher.service /etc/systemd/system/aperture-watcher.service
systemctl daemon-reload
systemctl enable --now aperture aperture-watcher
npm run check:live
```

Mount Aperture and Immich API under the existing Tollgate host:

```bash
cp deploy/nginx/tollgate-aperture.locations.conf /etc/nginx/snippets/tollgate-aperture.locations.conf
```

Then include the snippet inside the HTTPS `server` block for
`tollgate.gudman.xyz`, before `location /`. The exact archive location and
internal license-check subrequest are mandatory. Reload nginx only after its
configuration validates:

```bash
nginx -t
systemctl reload nginx
```

Optional standalone subdomains can still be enabled later after DNS resolves:

```bash
certbot certonly --webroot -w /var/www/html -d aperture.gudman.xyz -n --agree-tos
certbot certonly --webroot -w /var/www/html -d immich.gudman.xyz -n --agree-tos
cp deploy/nginx/aperture.gudman.xyz.conf /etc/nginx/sites-available/
cp deploy/nginx/immich.gudman.xyz.conf /etc/nginx/sites-available/
ln -s /etc/nginx/sites-available/aperture.gudman.xyz.conf /etc/nginx/sites-enabled/
ln -s /etc/nginx/sites-available/immich.gudman.xyz.conf /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```
