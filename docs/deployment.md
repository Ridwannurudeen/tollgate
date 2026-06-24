# Aperture Deployment

## Current gates

- Public app path is `https://tollgate.gudman.xyz/aperture`; no new DNS is required for the dashboard.
- Public archive downloads use the same host at `https://tollgate.gudman.xyz/immich/api/download/archive`.
- FeeRouter settlement stays disabled until Aperture has its own funded Arc payer key.
- EXIF enrichment needs `exiftool` on the VPS.

## VPS layout

- App directory: `/opt/aperture`
- Runtime environment: `/etc/aperture.env` with mode `600`
- Web service: `aperture.service` on `127.0.0.1:3036`
- Watcher service: `aperture-watcher.service`, reading `/var/log/nginx/access.log`
- Immich upstream: `http://127.0.0.1:2283`

## Runtime environment

```bash
APERTURE_IMMICH_API_BASE_URL=http://127.0.0.1:2283/api
APERTURE_BASE_PATH=/aperture
APERTURE_ACCESS_LOG=/var/log/nginx/access.log
APERTURE_LICENSE_FEE_ATOMIC_USDC=2500
APERTURE_FEE_ROUTER_ENABLED=0
APERTURE_EXIF_ENABLED=1
APERTURE_EXIFTOOL_PATH=exiftool
APERTURE_IMMICH_LIBRARY_ROOT=/opt/immich/library
```

When the project payer is funded, add `APERTURE_FEE_ROUTER_PRIVATE_KEY` on the
server only and set `APERTURE_FEE_ROUTER_ENABLED=1`.

## Commands

```bash
apt-get update
apt-get install -y libimage-exiftool-perl
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
`tollgate.gudman.xyz`, before `location /`, and reload nginx:

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
