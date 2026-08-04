# Citations Deployment

This is the root app at `https://tollgate.gudman.xyz`. Aperture is a separate
service with its own deployment doc (`aperture/docs/deployment.md`); nothing here
applies to it.

## Current gates

- `/opt/tollgate` is **not a git checkout**. It is a file-synced copy of `citations/`,
  so there is no `git pull` step and no working tree to inspect on the server.
- `/opt/tollgate/data` is live state — the hash-linked ledger, the source registry, and
  the FeeRouter split registry. Never sync over it. `data/sources.json` is deliberately
  untracked (commit `24e2604`), so a whole-tree copy destroys live data.
- `/api/proof` reports `deployedCommit` from the `LEPTONWEB_DEPLOY_COMMIT` environment
  variable, not from the shipped code. Skip that step and a deploy is invisible.

## VPS layout

- App directory: `/opt/tollgate`, owned by `tollgate:tollgate`
- Runtime environment: `/etc/tollgate.env` with mode `600`
- Persistent runtime data: `/opt/tollgate/data` (`ledger.json`, `sources.json`,
  `fee-router-splits.json`, `actor-classes.json`, `creator-registry.json`,
  `wordpress-sites.json`)
- Web service: `tollgate-web.service` on `127.0.0.1:3091`, user `tollgate` (nologin)
- Front end: `/etc/nginx/sites-enabled/tollgate.gudman.xyz.conf` proxies `location /`
  to `127.0.0.1:3091`, and includes the Aperture and Jellyfin location snippets ahead
  of it. Those snippets must keep their exact `auth_request` locations.

## Runtime environment

`/etc/tollgate.env` holds the LLM, Circle, facilitator, and FeeRouter/UseIntent signer
credentials. Two non-secret variables matter to deploys:

```bash
LEPTONWEB_DEPLOY_COMMIT=<short sha>   # what /api/proof reports; update every deploy
LEPTONWEB_PUBLIC_URL=https://tollgate.gudman.xyz
```

Optional settlement knobs, both read from `process.env` at call time — change the file
and restart, no rebuild needed:

```bash
LEPTONWEB_CLAIM_PRICE_ATOMIC=1000   # per supported claim; defaults to 1000 when unset
LEPTONWEB_X402_ENDPOINTS=[...]      # grounding allowlist; unset means no external buys
LEPTONWEB_X402_DAILY_CAP_ATOMIC     # bounds a day's external spend; defaults to 10000
```

`LEPTONWEB_CLAIM_PRICE_ATOMIC` is active whether or not it is set — unset falls back to
`DEFAULT_CLAIM_PRICE_ATOMIC_USDC`, it does not disable claim pricing. A malformed
`LEPTONWEB_X402_ENDPOINTS` throws at parse time rather than degrading into an uncapped
payer; unset is the safe no-op.

## Commands

Ship only the files a commit changed. Take a rollback copy first:

```bash
ssh root@75.119.153.252 "mkdir -p /root/tollgate-rollback && cd /opt/tollgate && tar czf /root/tollgate-rollback/src-pre.tar.gz <changed paths> && cp -a /etc/tollgate.env /root/tollgate-rollback/tollgate.env.bak"
```

Confirm the server has not drifted from the currently deployed commit before overwriting
anything — compare each file's checksum against that commit's blob:

```bash
git show <deployed sha>:citations/src/lib/foo.ts | tr -d '\r' | md5sum
ssh root@75.119.153.252 "tr -d '\r' < /opt/tollgate/src/lib/foo.ts | md5sum"
```

The `tr -d '\r'` is required. This repo is deployed from Windows with
`core.autocrlf=true`, so every file on the server is already CRLF; comparing raw bytes
reports every file as drifted.

Copy the changed files, then rebuild and restart:

```bash
git archive <sha> citations/src/lib/foo.ts citations/src/lib/bar.ts \
  | ssh root@75.119.153.252 "tar -x -C /opt/tollgate --strip-components=1"
ssh root@75.119.153.252 "chown tollgate:tollgate /opt/tollgate/src/lib/foo.ts /opt/tollgate/src/lib/bar.ts"
ssh root@75.119.153.252 "cd /opt/tollgate && npm run build && chown -R tollgate:tollgate .next"
ssh root@75.119.153.252 "sed -i 's/^LEPTONWEB_DEPLOY_COMMIT=.*/LEPTONWEB_DEPLOY_COMMIT=<short sha>/' /etc/tollgate.env"
ssh root@75.119.153.252 "systemctl restart tollgate-web"
```

Run `npm ci` before the build only when `package.json` changed. The server carries a full
dev install (`vitest`, `typescript`), and `next build` typechecks the tree, so a commit's
`.test.ts` files must ship alongside its source or the build fails on missing imports.

## Verify

```bash
curl -s https://tollgate.gudman.xyz/api/proof | jq '{deployedCommit, ledger: .ledger.verification, traction}'
```

`deployedCommit` must be the new sha, `ledger.verification.ok` must be `true` with zero
issues, and the traction counts must match their pre-deploy values — a changed count
after a code-only deploy means live data was overwritten. Then confirm the public
surfaces answer: `/`, `/core`, `/proof`, `/sources`, `/aperture`.

Settlement changes are not exercised by a restart. They run on the next paid query, which
spends USDC from the agent wallet, so prove them deliberately with `npm run prove:paid-query`
or `npm run prove:settled-paid-query` rather than assuming a clean boot means a clean path.

## Rollback

```bash
ssh root@75.119.153.252 "cd /opt/tollgate && tar xzf /root/tollgate-rollback/src-pre.tar.gz && npm run build && chown -R tollgate:tollgate .next"
ssh root@75.119.153.252 "sed -i 's/^LEPTONWEB_DEPLOY_COMMIT=.*/LEPTONWEB_DEPLOY_COMMIT=<old sha>/' /etc/tollgate.env && systemctl restart tollgate-web"
```
