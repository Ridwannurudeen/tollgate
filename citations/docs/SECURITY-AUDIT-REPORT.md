# Tollgate Security Audit Report

Audit date: 2026-07-17  
Branch: `leptonweb-mvp`  
Audited baseline revision: `c2ecf8e`  
Remediation worktree base: `a2b901fd57ea`  
Audit state: remediation complete in the uncommitted working tree; deployment
and operator actions remain

## Executive summary

The audit documented 37 numbered items: 12 CRITICAL, 10 HIGH, 7 MEDIUM, 4 LOW,
and 4 informational. The original report was frozen against `c2ecf8e` before
fixes; the detailed exploit evidence below remains a record of that baseline.

The current worktree remediates 32 code findings, including two containments:
the WordPress public pay route is now status/402-only, and Jellyfin live
settlement fails closed until a durable pre-payment journal and reconciliation
workflow exist. Two findings remain in OPERATOR-ACTION status (TG-SEC-022 and
TG-SEC-031). Three other items are informational: one accepted design boundary
and two verified trust/reproducibility notes (TG-SEC-028 through TG-SEC-030).

The highest-risk public paths now require authenticated or capability-bound
registration, fail closed without real payment settlement, reserve spend or
payment identities before asynchronous work, and use public projections at
data boundaries. Aperture's paid delivery paths settle directly to the
approved creator and recover from receipt outages without settling the same
payment twice.

Remaining operator work includes deploying the reviewed changes, reconciling
historical self-attested releases and adapter payouts, deciding credential
rotation/custody actions, deploying a v2 executor-bound registry if TG-SEC-022
is to be eliminated, and keeping Jellyfin live settlement disabled until its
durable journal is implemented.

No live deployment, key rotation, transaction, or server configuration change
was performed. Local application, environment-template, nginx, and deployment
documentation files were hardened only in this worktree.

## Summary table

| ID | Title | Severity | Primary evidence | Status |
| --- | --- | --- | --- | --- |
| TG-SEC-001 | Self-attestation clears probation and releases escrow | CRITICAL | `citations/src/app/api/sources/[sourceId]/verify/route.ts:47-69` | FIXED |
| TG-SEC-002 | Local x402 verification is unbound and replayable | CRITICAL | `citations/src/lib/x402-server.ts:131-149,187-245,311-358` | FIXED |
| TG-SEC-003 | Anyone can trigger a custodial creator claim | CRITICAL | `citations/src/app/api/creators/[wallet]/claim/route.ts:15-86` | FIXED |
| TG-SEC-004 | Shared demo-wallet caps are check-then-record races | CRITICAL | `citations/src/app/api/paid-query/demo/route.ts:112-198` | FIXED |
| TG-SEC-005 | Aperture creator registration can overwrite a payout owner | CRITICAL | `aperture/src/lib/onboarding.ts:108-195` | FIXED |
| TG-SEC-006 | WordPress public routes spend the operator wallet | CRITICAL | `citations/src/lib/wordpress.ts:189-230,406-459` | FIXED-BY-CONTAINMENT |
| TG-SEC-007 | Jellyfin public registration/webhooks can drain the operator wallet | CRITICAL | `jellyfin-sidecar/src/server.ts:110-123` | FIXED |
| TG-SEC-008 | PeerTube payout route is unauthenticated and raceable | CRITICAL | `peertube-plugin-tollgate/main.js:220-276` | FIXED |
| TG-SEC-009 | Aperture local proof can still trigger an operator payout | CRITICAL | `aperture/src/lib/license-download.ts:167-239` | FIXED |
| TG-SEC-010 | Free query route exposes unbounded operator-funded payouts | CRITICAL | `citations/src/app/api/query/route.ts:27-38` | FIXED |
| TG-SEC-011 | SSRF guards permit DNS rebinding and one mapped-IPv6 bypass | HIGH | `citations/src/lib/safe-fetch.ts:22-110` | FIXED |
| TG-SEC-012 | Aperture login and signup links are replayable | HIGH | `aperture/src/lib/account.ts:93-115` | FIXED |
| TG-SEC-013 | Source and Circle error responses expose private wallet metadata | HIGH | `citations/src/app/api/sources/[sourceId]/route.ts:74-82` | FIXED |
| TG-SEC-014 | Jellyfin public proof exposes viewer and session identifiers | HIGH | `jellyfin-sidecar/src/proof.ts:104-128` | FIXED |
| TG-SEC-015 | Public serializers expose email-pattern values in free text | HIGH | `citations/src/lib/proof-pack.ts:151-164` | FIXED |
| TG-SEC-016 | Several payout paths record reverted/replaced transactions as success | HIGH | `citations/src/lib/fee-router.ts:839-893,919-931` | FIXED |
| TG-SEC-017 | FeeRouter nonce allocation can create gaps or collide after reset | MEDIUM | `citations/src/lib/fee-router-nonce.ts:43-91` | FIXED |
| TG-SEC-018 | Public origins trust unvalidated Host headers | MEDIUM | `citations/src/lib/x402-server.ts:104-110` | FIXED |
| TG-SEC-019 | RSS and source verification decode unbounded response bodies | MEDIUM | `citations/src/lib/rss-import.ts:38-58` | FIXED |
| TG-SEC-020 | Aperture performs costly work before payment and without endpoint limits | MEDIUM | `aperture/src/lib/link-download.ts:136-229` | FIXED |
| TG-SEC-021 | Several rate limits trust a caller-controlled forwarded IP | MEDIUM | `citations/src/app/api/query/route.ts:29-33` | FIXED |
| TG-SEC-022 | Permissionless registry anchoring enables nonce front-run denial of service | MEDIUM | `citations/contracts/UseReceiptRegistry.sol:72-83` | OPERATOR-ACTION |
| TG-SEC-023 | Public proof requests can spawn a Git process per request | MEDIUM | `citations/src/lib/proof-pack.ts:12-25` | FIXED |
| TG-SEC-024 | Public proofs expose internal URLs and conditional host paths | LOW | `aperture/src/lib/proof-pack.ts:50-57` | FIXED |
| TG-SEC-025 | Wallet case variants split one creator into multiple rows | LOW | `citations/src/lib/ledger.ts:632-681` | FIXED |
| TG-SEC-026 | Setup/proof CLIs print operator-only wallet identifiers | LOW | `citations/scripts/prove-w3s-source.mjs:19-30` | FIXED |
| TG-SEC-027 | Raw refund errors may persist secret-bearing upstream text | LOW | `citations/src/lib/settlement.ts:650-669` | FIXED |
| TG-SEC-028 | PayGate does not sign the concrete split array | INFO | `citations/contracts/PayGate.sol:57-80` | ACCEPTED-INFO |
| TG-SEC-029 | Core dependency baseline and package-specific audit scope | INFO | package lockfiles | VERIFIED-INFO |
| TG-SEC-030 | PayGate verification input has a newline reproducibility mismatch | INFO | `citations/verification/PayGate.standard.json:5` | VERIFIED-INFO |
| TG-SEC-031 | Ignored local Circle credentials require owner custody review | INFO | `citations/.env.local` | OPERATOR-ACTION |
| TG-SEC-032 | Immich licensing could double-pay and lacked a durable payment journal | CRITICAL | `aperture/src/lib/license-download.ts` | FIXED |
| TG-SEC-033 | Immich archive authorization was reusable and bypassable | HIGH | `aperture/src/lib/license-check.ts` | FIXED |
| TG-SEC-034 | Archive eligibility/body mismatches enabled unpaid or unsafe routing | HIGH | `aperture/src/lib/immich.ts` | FIXED |
| TG-SEC-035 | Jellyfin live settlement lacked crash-safe journaling | CRITICAL | `jellyfin-sidecar/src/config.ts` | FIXED-BY-CONTAINMENT |
| TG-SEC-036 | PeerTube installed advisory-affected `ws@8.20.1` | HIGH | `peertube-plugin-tollgate/package-lock.json` | FIXED |
| TG-SEC-037 | Generic link downloads could charge before durable delivery | HIGH | `aperture/src/lib/link-download.ts` | FIXED |

## Detailed findings

### TG-SEC-001 — Self-attestation clears probation and releases escrow

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: an anonymous HTTP caller crosses from public source metadata
management into escrow authorization and a real FeeRouter release.

Attacker input: a source ID and
`{"method":"creator-claimed","attest":true}` sent to the public verification
route.

Exploit path:

1. `citations/src/app/api/sources/[sourceId]/verify/route.ts:47-69` accepts the
   PATCH without authenticating the source owner.
2. The `creator-claimed` branch calls `claimSourceAsCreator` at lines 62-63.
3. `citations/src/lib/catalog.ts:902-939` requires only `attest === true` and
   writes `creatorClaimed: true` plus `probation: false`.
4. The route immediately calls `releaseEscrowForSource` at line 65.
5. `citations/src/lib/escrow.ts:36-39,152-200` treats cleared probation as
   release authorization and invokes the FeeRouter.

An attacker can first register somebody else's URL with the attacker's payout
wallet, self-attest, and release escrow. The caller-selected creator filter on
the free query route makes this path easier to monetize repeatedly.

Impact: unauthorized settlement-state mutation and unauthorized fund movement.

Fix: remove the public self-attestation release path. Only successful domain
control through the existing DNS or HTML-meta verification methods may clear
probation or release escrow. A display-only claim, if retained, must remain
probationary.

Regression test: an anonymous `creator-claimed` PATCH cannot clear probation,
does not call `routeEscrowReleasePayment`, and leaves pending escrow unchanged;
successful DNS/meta verification still releases once.

Remediation evidence: the verification route now rejects `creator-claimed`
with 403 and retains escrow release only for a successful domain-control
result. `citations/src/app/api/sources/[sourceId]/verify/route.test.ts` and
`citations/src/lib/settlement.test.ts` cover the blocked self-claim and
domain-verified release paths.

Operator action: block this method until the application fix is deployed, then
audit and reconcile historical escrow-release receipts whose ownership method
was `creator-claimed`.

### TG-SEC-002 — Local x402 verification is unbound and replayable

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: an untrusted payment header crosses into paid content,
settlement evidence, and operator-funded creator payout/refund paths.

Attacker input: a valid EIP-3009 signature over caller-chosen authorization
fields, paired with an unsigned `accepted` object that matches the server's
offer.

Exploit path:

1. `citations/src/lib/x402-server.ts:131-149` compares the unsigned
   `payload.accepted` object to the offer.
2. The local verifier at lines 187-245 verifies the signature over the
   caller's authorization but does not bind signed `to` or `value` to the
   required recipient and amount.
3. It does not enforce `validAfter`, `validBefore`, or consume the nonce.
4. Lines 311-358 automatically select this verifier when the facilitator key
   is absent.
5. Paid-query settlement can route operator-funded citation payouts and a
   reader refund from the accepted result.

`aperture/src/lib/x402-server.ts:187-231,325-353` repeats the verifier; its use
is gated by `APERTURE_ALLOW_VERIFY_ONLY=1`, but affected download flows can
also route operator-funded payouts.

The installed `@x402/evm` 2.17.0 facilitator performs the missing
recipient/value/time checks. The application fallback does not.

Impact: forged or replayed authorization can unlock content, append false
settlement state, and trigger operator-funded transfers.

Fix: fail closed on fund-moving routes unless official facilitator/Gateway
settlement succeeds. If a strictly non-fund-moving verify-only demonstration is
retained, validate all signed fields and time bounds and atomically consume a
hash-only authorization nonce; it must never feed a payout or refund path.

Regression tests: both applications fail closed with 503 when exact settlement
is unconfigured, and paid success evidence is produced only after a configured
Gateway/facilitator settlement.

Remediation evidence: `citations/src/lib/x402-server.ts` and
`aperture/src/lib/x402-server.ts` now expose only Gateway/facilitator
verify-and-settle paths for paid requests and return 503 when settlement is
unconfigured. Their respective `x402-server.test.ts` suites cover the
fail-closed and settled-only behavior.

### TG-SEC-003 — Anyone can trigger a custodial creator claim

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: knowledge of a public wallet address crosses into Circle W3S
signing and an on-chain claim transaction.

Attacker input: a bare POST to
`/api/creators/{wallet}/claim`.

Exploit path:

1. `citations/src/app/api/creators/[wallet]/claim/route.ts:15-20` explicitly
   performs no owner authentication.
2. Lines 21-86 load the stored Circle wallet ID and submit the custodial
   `claim()` operation.
3. Public source registration accepts caller-supplied `custody` and `walletId`
   fields in `citations/src/lib/catalog.ts:374-405`, even though the claim
   route later treats them as server-provisioned metadata.

Impact: unauthenticated settlement-state/on-chain writes, gas consumption, and
abuse of the Circle signer. The destination is bounded, but that is not a
substitute for authorization.

Fix: never accept `circle-w3s` custody or `walletId` from public JSON. Require a
creator session or one-time onboarding capability bound to the owner and
server-provisioned wallet before signing a claim.

Regression tests: a bare POST returns 401; the operator capability cannot
authorize a self-claimed source; public registration cannot inject Circle
custody metadata; an authorized domain-verified custodial source can claim.

Remediation evidence:
`citations/src/app/api/creators/[wallet]/claim/route.ts` requires the operator
claim capability and a stored domain-verified custodial source, while
`citations/src/lib/catalog.ts` ignores public custody injection.
`citations/src/app/api/creators/[wallet]/claim/route.test.ts`,
and `citations/src/lib/settlement.test.ts` cover these boundaries.

### TG-SEC-004 — Shared demo-wallet caps are check-then-record races

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: concurrent public requests cross a configured per-IP/global
spend ceiling into multiple Circle W3S payments.

Attacker input: concurrent demo requests launched before any one request
finishes settlement.

Exploit path:

- Citations checks the cap at
  `citations/src/app/api/paid-query/demo/route.ts:112-120`, performs payment
  work through line 196, and records use only at lines 197-198. The split
  assert/record API is in `citations/src/lib/rate-limit.ts:192-239`.
- Aperture repeats the pattern at
  `aperture/src/app/api/links/[id]/download/demo/route.ts:77-126` and
  `aperture/src/lib/link-rate-limit.ts:79-125`.

All concurrent calls can observe the same unused quota before any call records
its spend.

Impact: operator wallet spend beyond both the per-IP and global configured
caps.

Fix: atomically reserve quota before the first asynchronous payment operation,
commit the reservation on success, and release it only on a failure that
occurred before settlement. Use a durable atomic store when more than one
application instance can serve the route.

Regression tests: concurrent requests cannot exceed either cap; a
pre-settlement failure releases its reservation; a post-settlement failure
does not make the spent quota reusable.

Remediation evidence: `citations/src/lib/rate-limit.ts` and
`aperture/src/lib/link-rate-limit.ts` reserve quota before asynchronous work;
the demo routes release only proven pre-settlement failures.
`citations/src/app/api/paid-query/demo/route.test.ts`,
`citations/src/lib/rate-limit.test.ts`,
`aperture/src/app/api/links/[id]/download/demo/route.test.ts`, and
`aperture/src/lib/link-demo-rate-limit.test.ts` cover concurrency and release
timing.

### TG-SEC-005 — Aperture creator registration can overwrite a payout owner

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: an anonymous registration body crosses into the trusted
owner-to-payout-wallet registry.

Attacker input: a victim `ownerId`, attacker's wallet, and a valid signature
from the attacker's wallet.

Exploit path:

1. Public `POST /api/creators` accepts caller-selected `ownerId` at
   `aperture/src/app/api/creators/route.ts:17-44`.
2. `aperture/src/lib/onboarding.ts:108-164` builds a new entry whose
   wallet-signed status proves only the attacker's wallet, not authority over
   the owner ID.
3. Lines 166-195 find an existing owner and replace its entry while preserving
   selected account fields.
4. `aperture/src/lib/registry.ts:117-129` implements replacement by `ownerId`.
5. License/link payout resolution trusts the resulting owner mapping.

Impact: payout diversion from an existing creator to an attacker-controlled
wallet. Omitting a wallet can also cause an unauthenticated Circle mint before
the overwrite check.

Fix: make public registration create-only and perform the uniqueness check
under the registry write lock before any wallet mint or external call. Existing
owners may be modified only through a session-scoped owner route.

Regression tests: registering an existing owner ID cannot mint, overwrite, or
change payout resolution; two concurrent create attempts yield exactly one
owner; an authenticated owner-specific update remains scoped to that owner.

Remediation evidence: `aperture/src/app/api/creators/route.ts` requires the
registration capability, and `aperture/src/lib/onboarding.ts` performs the
create-only duplicate check under the registry lock before wallet minting.
`aperture/src/app/api/creators/route.test.ts` and
`aperture/src/lib/onboarding.test.ts` cover authorization and duplicate races.

### TG-SEC-006 — WordPress public routes spend the operator wallet

Severity: **CRITICAL**  
Status: **FIXED-BY-CONTAINMENT**

Trust boundary: an anonymous Internet caller crosses into operator-funded
FeeRouter settlement.

Attacker input: a public site registration with an attacker wallet, followed by
pay requests for attacker-selected post metadata and price.

Exploit path:

1. `citations/src/app/api/wordpress/sites/register/route.ts:19-32` is public
   and only rate-limited.
2. `citations/src/lib/wordpress.ts:189-230` registers an arbitrary site URL and
   payout wallet and returns a usable site key.
3. The pay route accepts that key at
   `citations/src/app/api/wordpress/posts/[postId]/pay/route.ts:27-58`.
4. The request price is allowed up to 1,000,000,000 atomic USDC at
   `citations/src/lib/wordpress.ts:262-275`.
5. `settleWordPressPost` checks the ledger, awaits the external payout, then
   appends the receipt at lines 406-459. Concurrent identical requests can all
   pay before deduplication.
6. The WordPress plugin's own callback is public:
   `wordpress-plugin-tollgate/tollgate.php:228-239` uses
   `permission_callback => __return_true`.

Impact: attacker-selected operator-wallet transfers and duplicate payouts.

Fix: require an operator-issued registration capability, bind the resulting
site key to immutable approved site/wallet/price limits, and require a real
reader payment authorization before any operator-funded creator transfer.
Serialize the idempotency check, transfer, and receipt commit per event.

Regression tests: public registration is rejected; a site key cannot alter its
wallet/price binding; an unpaid reader request cannot spend operator funds; two
concurrent requests create one transfer and one receipt.

Remediation evidence: site registration now requires an operator capability
and preserves immutable bindings in `citations/src/lib/wordpress.ts`. The
public pay route returns only an existing status or 402 requirement; the
separate settlement helper requires exact `x402-settled` evidence and
serializes each event. `citations/src/lib/wordpress.test.ts`,
`citations/src/app/api/wordpress/sites/register/route.test.ts`, and
`citations/src/app/api/wordpress/posts/[postId]/pay/route.test.ts` cover these
boundaries.

### TG-SEC-007 — Jellyfin public registration/webhooks can drain the operator wallet

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: anonymous operator registration and caller-authored playback
telemetry cross into operator-funded FeeRouter settlement.

Attacker input: an arbitrary item-to-wallet registration followed by webhook
payloads with attacker-selected playback positions, runtime, and timestamps.

Exploit path:

1. `jellyfin-sidecar/src/server.ts:110-123` publicly registers an operator and
   returns its API key.
2. `jellyfin-sidecar/src/operators.ts:206-305` accepts arbitrary item, wallet,
   and per-minute price configuration and replaces mappings.
3. `jellyfin-sidecar/src/jellyfin.ts:226-249,277-292` trusts caller-authored
   playback duration and computes an unbounded payout.
4. It checks for a receipt at lines 263-267, settles at 286-292, and appends at
   line 313, permitting concurrent duplicate transfers.

Impact: arbitrary and duplicate operator-wallet transfers.

Fix: require an operator bootstrap secret or offline approval for
registration, bind keys to immutable operator configuration, validate playback
against server-fetched Jellyfin state and hard payout limits, and serialize
settlement per event.

Regression tests: anonymous registration fails; webhook duration cannot exceed
trusted media/session bounds; price and wallet cannot be changed by webhook
input; concurrent duplicate events transfer once.

Remediation evidence: `jellyfin-sidecar/src/server.ts` and `operators.ts`
require a registration capability and immutable item scope;
`jellyfin-sidecar/src/jellyfin.ts` verifies playback against Jellyfin, applies
event/daily caps, and serializes duplicates.
`jellyfin-sidecar/tests/sidecar.test.ts` covers registration, scope, playback
verification, caps, and concurrency; live spend also remains disabled under
TG-SEC-035.

### TG-SEC-008 — PeerTube payout route is unauthenticated and raceable

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: a public plugin route crosses into the configured operator
private key and creator transfer.

Attacker input: POST requests to `/video/{videoId}/pay`.

Exploit path:

1. The client includes `peertubeHelpers.getAuthHeader()` at
   `peertube-plugin-tollgate/client/tollgate-watch.js:3-12`.
2. The server route at `peertube-plugin-tollgate/main.js:220-276` never
   authenticates the PeerTube user.
3. It checks for a receipt at lines 229-239, transfers at lines 253-264, and
   appends at lines 266-276. Concurrent calls can all transfer before the
   receipt exists.

Impact: unauthenticated and duplicate operator-wallet transfers.

Fix: require an authenticated PeerTube user using the plugin helper's
server-side user lookup, apply a per-user spend limit, and serialize payment
and receipt creation per video/event.

Regression tests: anonymous POST is rejected; an authenticated request pays
once; concurrent authenticated duplicates cause one transfer.

Remediation evidence: `peertube-plugin-tollgate/main.js` now resolves the
authenticated user and existing video, enforces a persistent per-user daily
cap, and locks payment per video.
`peertube-plugin-tollgate/test/tollgate.test.mjs` covers anonymous rejection,
missing videos, the daily cap, and concurrent duplicates.

### TG-SEC-009 — Aperture local proof can still trigger an operator payout

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: a development-only header crosses into a live FeeRouter payout
when two environment flags/configurations are enabled together.

Attacker input: `X-APERTURE-LOCAL-PROOF: 1` on a license download while
`APERTURE_LICENSE_LOCAL_PROOF=1`.

Exploit path:

1. `aperture/src/lib/license-download.ts:167-189` skips x402 settlement for
   local proof.
2. Lines 222-239 still call the injected `routeLicensePayment` before falling
   back to local-proof evidence.
3. The production route always injects the real payout function at
   `aperture/src/app/api/license-download/route.ts:38-50`.

Impact: an unpaid request can move operator funds whenever local proof and live
FeeRouter configuration coexist.

Fix: local proof must be structurally incapable of invoking
`routeLicensePayment`; it may only produce explicitly local,
non-settled evidence.

Regression test: an explicit local-proof unlock records only the `local-proof`
label and remains outside the x402 settlement branch.

Remediation evidence: `aperture/src/lib/license-download.ts` now builds local
proof directly as `local-proof` evidence, structurally separate from x402
settlement. `aperture/src/lib/license-download.test.ts` covers the explicit
local-proof branch and its non-settled label.

### TG-SEC-010 — Free query route exposes unbounded operator-funded payouts

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: a free public query crosses into the application operator's
PayGate/FeeRouter funds.

Attacker input: a caller-selected creator wallet and source-biased question,
with rotated `X-Forwarded-For` values.

Exploit path:

1. `citations/src/app/api/query/route.ts:27-38` accepts `creator` and invokes
   `settleQuestion`.
2. `citations/src/lib/settlement.ts:536-561` filters candidates to that wallet.
3. `settleQuestion` routes PayGate/FeeRouter payments at lines 266-321.
4. The only query guard is 12 requests per minute per key in
   `citations/src/lib/rate-limit.ts:36-52`; it has no global spend budget.
5. The route trusts the caller-controlled left-most forwarded address before
   the proxy-set address at lines 29-33.

Self-attestation from TG-SEC-001 lets an attacker manufacture an immediately
payable destination, but any attacker-controlled verified source is sufficient
to target the sponsored payout.

Impact: operator-wallet drain beyond the intended public-query rate.

Fix: separate free answer generation from real settlement. Any sponsored
settlement mode must use an atomic, durable global amount budget plus per-user
authorization and must not accept a caller-selected payout destination.

Regression test: a free query calls settlement with payments disabled, and
spoofed forwarded headers do not create new rate buckets.

Remediation evidence: `citations/src/app/api/query/route.ts` now always calls
the settlement engine with `settlePayments: false`, and the shared rate-key
logic uses trusted proxy identity.
`citations/src/app/api/query/route.test.ts` and
`citations/src/lib/rate-limit.test.ts` cover both constraints.

### TG-SEC-011 — SSRF guards permit DNS rebinding and one mapped-IPv6 bypass

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: an attacker-controlled URL crosses into the server's outbound
network access.

Attacker input: a direct hex-form IPv4-mapped IPv6 literal or a hostname whose
DNS answer changes between validation and connection.

Exploit path:

- `citations/src/lib/safe-fetch.ts:22-30` blocks dotted mapped IPv6 but not
  forms such as `::ffff:7f00:1`. `isIpLiteral` treats the address as already
  checked, so no DNS lookup follows.
- Both guards resolve and validate addresses, then call ordinary `fetch(url)`
  in a separate resolution step:
  `citations/src/lib/safe-fetch.ts:78-110` and
  `aperture/src/lib/safe-fetch.ts:77-108`.
- Redirect destinations are revalidated, but the connect-time address is not
  pinned to the validated result.

Impact: access to loopback, private services, link-local metadata endpoints, or
other internal hosts.

Fix: port Aperture's mapped-IPv6 normalization to Citations and use a
request-scoped dispatcher that pins each connection to a validated DNS answer
while preserving the original Host header and TLS SNI. Revalidate and repin
every redirect hop. Enforce byte limits before decode.

Regression tests: all dotted/hex/compressed mapped-loopback forms are rejected;
a rebinding hostname cannot connect to a second private answer; public
redirects work while redirects to private addresses fail.

Remediation evidence: both `safe-fetch.ts` implementations reject mapped and
non-global addresses across every DNS answer, pin the validated answer through
an Undici dispatcher, and revalidate redirects. The corresponding
`citations/src/lib/safe-fetch.test.ts` and
`aperture/src/lib/safe-fetch.test.ts` suites cover mapped encodings, rebinding,
dispatcher pinning, and redirect bypasses.

### TG-SEC-012 — Aperture login and signup links are replayable

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: possession of a previously used email link crosses back into a
fresh authenticated session.

Attacker input: reuse of a redeemed stored login token or a previously used
stateless signup token within its validity period.

Exploit path:

1. `aperture/src/lib/account.ts:93-115` finds a matching login token but does
   not clear it.
2. The existing test explicitly expects a second redemption to succeed.
3. `aperture/src/app/login/verify/[token]/route.ts:134-164` accepts a replayed
   signup token and, if the email already exists, returns that existing owner
   and creates a session.

Impact: replay-based account authentication and session creation.

Fix: consume stored login tokens atomically under the registry write lock.
Treat signup registration as create-once; once its email exists, the old signup
token must fail rather than logging into the existing account.

Regression tests: only one of two concurrent redemptions succeeds; a redeemed
login token fails; a used signup token cannot log into the account it created;
a newly issued normal login link still works.

Remediation evidence: `aperture/src/lib/account.ts` consumes login tokens under
the registry lock, and the login verification route rejects a signup token
once its email exists. `aperture/src/lib/account.test.ts` and
`aperture/src/app/login/verify/[token]/route.test.ts` cover concurrent
redemption and signup replay.

### TG-SEC-013 — Source and Circle error responses expose private wallet metadata

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: operator-only notification and Circle custody identifiers cross
into public HTTP responses.

Attacker input: paid source access, unauthenticated source verification, or a
registration flow that causes a post-mint Circle request to fail.

Exploit path:

- `CreatorSource` contains `walletId` and `notifyEmail` at
  `citations/src/lib/types.ts:48-71`.
- The intended sanitizer at `citations/src/lib/catalog.ts:792-796` strips both.
- `citations/src/app/api/sources/[sourceId]/route.ts:74-82` returns the raw
  source after payment.
- `citations/src/app/api/sources/[sourceId]/verify/route.ts:66-69` spreads a raw
  `source` and the raw `sources[]` registry.
- Circle helpers include upstream bodies and request paths in errors, and the
  public registration routes echo `error.message`. A failure after mint can
  include the minted wallet ID in the path.

Impact: public disclosure of notification email and server-only Circle wallet
identifiers.

Fix: recursively apply the existing public source projection and replace raw
Circle error strings at public boundaries with stable error codes/messages.

Regression tests: both source routes omit `walletId` and `notifyEmail` at every
nesting depth; a sentinel Circle wallet ID and upstream response body never
appear in a registration error.

Remediation evidence: `citations/src/lib/catalog.ts` applies the recursive
public projection, the source detail and verification routes use it, and
registration routes return stable errors.
`citations/src/app/api/sources/[sourceId]/route.test.ts`,
`citations/src/app/api/sources/[sourceId]/verify/route.test.ts`,
`citations/src/app/api/sources/route.test.ts`,
`citations/src/app/api/sources/discover/route.test.ts`, and
`citations/src/lib/catalog.test.ts` cover nested metadata and Circle-error
sentinels.

### TG-SEC-014 — Jellyfin public proof exposes viewer and session identifiers

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: private playback/account identifiers cross into an
unauthenticated proof endpoint.

Attacker input: a GET to the public proof route.

Exploit path:

1. `jellyfin-sidecar/src/server.ts:105-107` exposes the proof without auth.
2. `jellyfin-sidecar/src/proof.ts:104-128` returns the raw registry and ledger.
3. `jellyfin-sidecar/src/types.ts:91-92` stores raw `userId` and `sessionId` in
   each public receipt.

Impact: public disclosure of viewing activity and linkable user/session
identifiers.

Fix: return a public receipt projection that preserves hash/evidence fields but
removes or one-way pseudonymizes viewer/session identifiers. Do not mutate
historical ledger records.

Regression test: proof JSON contains no raw user/session values while ledger
verification remains valid.

Remediation evidence: `jellyfin-sidecar/src/proof.ts` projects public receipts
without `userId` or `sessionId` while leaving stored records unchanged.
`jellyfin-sidecar/tests/sidecar.test.ts` verifies both the public omission and
unchanged ledger data.

### TG-SEC-015 — Public serializers expose email-pattern values in free text

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: fetched or caller-controlled text crosses into public sources,
receipts, ledger, and proof APIs without the value-level PII boundary required
by `SECURITY.md`.

Attacker input: an email address embedded in source excerpts, titles,
descriptions, questions, answers, or related public free-text fields.

Exploit path:

- `citations/src/lib/catalog.ts:792-796` strips named private fields but retains
  content excerpts and other free text.
- `citations/src/lib/proof-pack.ts:151-164`, the public ledger route, and the
  public receipt route serialize stored text.
- The tracked source/ledger data contains email-pattern values; values were not
  copied into this report.
- Aperture public creator/link/proof projections likewise allow email-pattern
  text in display names, titles, descriptions, and EXIF-derived fields.

Impact: PII leakage through a public API/proof pack.

Fix: recursively redact email-pattern values at every public projection,
including source records, ledger/proof JSON, server-rendered pages, and 402
descriptions. Keep stored hash-bound records unchanged and expose the original
record hashes so verification still works.

Regression tests use sentinel emails at the named serializers and unpaid
source description. Static page checks require each stored-text consumer to
call `publicSource`/`publicLedger`; stored historical hashes continue to verify.

Remediation evidence: both applications use their shared public-data
projection at proof/API boundaries. Citations additionally applies
`publicSource`/`publicLedger` before its public pages render stored text, while
`citations/src/app/api/sources/[sourceId]/route.ts` builds its 402 description
from the projected source. `citations/src/lib/public-data.test.ts` combines
sentinel projection checks with the static page-boundary assertions;
`citations/src/app/api/sources/[sourceId]/route.test.ts` covers the 402 body,
and the corresponding Aperture public-data/proof tests cover its serializers
without rewriting stored hashes.

### TG-SEC-016 — Several payout paths record reverted/replaced transactions as success

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: an RPC receipt crosses into permanent settlement evidence.

Attacker/failure input: a mined receipt with `status: reverted`, or a replaced
transaction returned by the wallet client.

Exploit path:

- Citations has a correct receipt-status helper at
  `citations/src/lib/fee-router.ts:162-176` and uses it for normal payouts, but
  escrow release and refund paths only await a receipt at lines 839-893 and
  919-931 before returning success evidence.
- Equivalent unchecked paths exist in
  `aperture/src/lib/fee-router.ts:302-329,373-415`,
  `peertube-plugin-tollgate/lib/fee-router.js:108-130,182-218`, and
  `jellyfin-sidecar/src/fee-router.ts:311-338,400-440`.
- `pay-per-piece/src/fee-router.ts:257-265,401-445` is checked-clean prior art.

Impact: false `forum-routed` evidence, suppressed retry, and a ledger that says
funds moved when they did not.

Fix: centralize the existing successful-receipt/replacement checks within each
package and require them before persisting evidence.

Regression tests: reverted or replaced escrow, refund, and sidecar payouts do
not return success or append settlement evidence.

Remediation evidence: the Citations, Aperture, Jellyfin, and PeerTube FeeRouter
implementations now reject reverted receipts and transaction-hash
replacements before producing evidence. `citations/src/lib/fee-router.test.ts`,
`aperture/src/lib/fee-router.test.ts`,
`jellyfin-sidecar/tests/fee-router.test.ts`, and
`peertube-plugin-tollgate/test/fee-router.test.mjs` exercise the affected
approval, split, payout, escrow, and refund stages.

### TG-SEC-017 — FeeRouter nonce allocation can create gaps or collide after reset

Severity: **MEDIUM**  
Status: **FIXED**

Trust boundary: an asynchronous submission error crosses into shared account
nonce state.

Attacker/failure input: a pre-broadcast submission failure or a nonce-too-low
error while sibling submissions have reserved nonces.

Exploit path:

1. `citations/src/lib/fee-router-nonce.ts:43-65` increments cached state before
   submission.
2. Generic submission failures leave that increment in place, potentially
   stranding all later transactions behind a nonce that never reached the
   mempool.
3. Lines 73-91 delete and reseed the shared state on a narrow error while
   sibling reservations from the old state may still be active.

Impact: payout availability failure, nonce gaps, or duplicate reservations
under concurrency.

Fix: serialize reserve plus submit per account and reread the pending chain
nonce after every failed submission, following the working pattern in
`pay-per-piece/src/fee-router-nonce.ts:43-85`.

Regression tests: a pre-broadcast rejection reuses the chain pending nonce;
queued siblings remain on one state if reconciliation also fails; concurrent
submission work respects its configured bound.

Remediation evidence: `citations/src/lib/fee-router-nonce.ts` queues reserve
plus submit per account and rereads the pending nonce after a failed
submission. `citations/src/lib/fee-router-nonce.test.ts` covers reconciliation,
queued siblings, and bounded concurrent submissions.

### TG-SEC-018 — Public origins trust unvalidated Host headers

Severity: **MEDIUM**  
Status: **FIXED**

Trust boundary: an inbound proxy header crosses into public payment-resource,
share, and redirect URLs.

Attacker input: a crafted `Host` or `X-Forwarded-Host` value on deployments
whose upstream passes it through.

Exploit path:

- `citations/src/lib/x402-server.ts:104-110` and the Aperture equivalent build
  public origins from forwarded protocol/host.
- `aperture/src/app/login/verify/[token]/route.ts:102-125` has a separate
  request-derived origin path.
- These values feed x402 resource descriptions and Aperture public
  links/redirects.

Current tracked Next configuration prevents the stronger host-to-arbitrary-W3S
signing scenario, so that scenario is not reported as confirmed.

Impact: link poisoning and attacker-selected public/resource origins.

Fix: accept only configured canonical public origins and explicit local
development origins; reject or fall back on any other Host value.

Regression test: forwarded attacker hosts never appear in payment requirements,
share links, or login redirects.

Remediation evidence: both applications now derive public URLs through their
`public-origin.ts` modules, and the Aperture login verifier uses that canonical
origin for redirects. The two `public-origin.test.ts` suites and the login
route test cover configured origins and forwarded-host poisoning:
`citations/src/lib/public-origin.test.ts`,
`aperture/src/lib/public-origin.test.ts`, and
`aperture/src/app/login/verify/[token]/route.test.ts`.

### TG-SEC-019 — RSS and source verification decode unbounded response bodies

Severity: **MEDIUM**  
Status: **FIXED**

Trust boundary: an attacker-controlled HTTP response crosses into process
memory.

Attacker input: a registered source/feed that streams a very large response.

Exploit path:

- `citations/src/lib/rss-import.ts:38-58` calls `response.text()` for the
  initial URL and up to four feed candidates without a byte cap.
- `citations/src/lib/source-verification.ts:53-77` does the same during public
  ownership verification.
- Item-count and timeout caps do not limit the amount buffered before decode.

Impact: memory exhaustion and request-worker denial of service.

Fix: read the response stream through a shared byte-capped reader and abort
before decoding once the cap is exceeded.

Regression test: a chunked body exceeding the configured cap is aborted before
decode; bounded valid RSS/HTML still works.

Remediation evidence: `citations/src/lib/safe-fetch.ts` supplies the shared
capped stream reader, and RSS import/source verification use a 512 KiB limit
before text decoding. `citations/src/lib/rss-import.test.ts` and
`citations/src/lib/source-verification.test.ts` cover oversized chunked bodies
and bounded valid responses.

### TG-SEC-020 — Aperture performs costly work before payment and without endpoint limits

Severity: **MEDIUM**  
Status: **FIXED**

Trust boundary: an unpaid public request crosses into outbound fetches and
Immich fan-out.

Attacker input: repeated unsigned link-download/license-download requests with
attacker-selected links or large asset ID lists.

Exploit path:

- `aperture/src/lib/link-download.ts:136-229` probes URL content before
  returning 402 for a missing payment signature.
- `aperture/src/app/api/license-download/route.ts:16-55` has no endpoint rate
  limit and accepts an unbounded `assetIds` array before resolving the shared
  link and each owner.

Impact: outbound-fetch and internal-API cost amplification without payment.

Fix: return payment requirements before source probing whenever requirements
can be computed without it; cap `assetIds`; add the existing trusted-IP rate
limiter to the license endpoint.

Regression tests: an unsigned link request performs no external content probe;
oversized asset lists fail before Immich access; rate-limited requests perform
no downstream work.

Remediation evidence: `aperture/src/lib/link-download.ts` returns 402 before
loading link bytes, while the license-download route caps asset IDs at 100 and
applies the shared limiter before downstream work.
`aperture/src/lib/link-download.test.ts`,
`aperture/src/app/api/license-download/route.test.ts`, and
`aperture/src/lib/license-download-rate-limit.test.ts` cover all three
constraints.

### TG-SEC-021 — Several rate limits trust a caller-controlled forwarded IP

Severity: **MEDIUM**  
Status: **FIXED**

Trust boundary: a caller-controlled header crosses into security and spend
rate-limit identity.

Attacker input: arbitrary left-most `X-Forwarded-For` values.

Exploit path: the query, source registration, RSS import, and creator-claim
routes select the left-most forwarded value before the proxy-set
`X-Real-IP`. Representative evidence is
`citations/src/app/api/query/route.ts:29-33`; corresponding patterns exist in
`sources/route.ts`, `import/rss/route.ts`, and
`creators/[wallet]/claim/route.ts`.

Impact: bypass of LLM, fetch, registration, signing, and payout attempt limits.

Fix: use the trusted reverse proxy's `X-Real-IP` first, or the known
proxy-appended right-most forwarded address when no real-IP header exists.
Keep the logic in one existing rate-key implementation rather than duplicating
parsers.

Regression test: changing the left-most forwarded value does not change the
bucket when `X-Real-IP` is present.

Remediation evidence: `citations/src/lib/rate-limit.ts` centralizes identity on
`X-Real-IP`, falling back to the right-most forwarded address.
`citations/src/lib/rate-limit.test.ts` covers both precedence rules, and the
affected route tests use the shared parser.

### TG-SEC-022 — Permissionless registry anchoring enables nonce front-run denial of service

Severity: **MEDIUM**  
Status: **OPERATOR-ACTION**

Trust boundary: a copied pending signature crosses into the globally consumed
on-chain nonce.

Attacker input: a valid signed intent copied from pending `PayGate` calldata.

Exploit path:

1. `citations/contracts/UseReceiptRegistry.sol:72-83` permits any caller to
   anchor a valid signed intent and consumes its nonce.
2. The signature does not bind an executor/caller.
3. An observer can front-run `PayGate.payWithIntent` with `anchor(intent,sig)`.
4. The original PayGate transaction then reverts when it attempts to anchor the
   now-used nonce.

No funds are stolen, but the intended settlement is denied. This boundary is
already noted in project judge documentation.

Fix: a v2 intent must bind an executor and `anchor` must require that executor.
Standalone intents can bind the agent; atomic payment intents can bind the
PayGate.

Regression test/call sequence: copied signature sent by a non-executor reverts;
the bound PayGate can anchor and pay atomically once.

Operator action: deploy a new registry and PayGate and update application
configuration after source/test review. Existing deployed bytecode is
immutable; no deployment was performed during this audit.

### TG-SEC-023 — Public proof requests can spawn a Git process per request

Severity: **MEDIUM**  
Status: **FIXED**

Trust boundary: an unauthenticated request crosses into process creation.

Attacker input: repeated GET requests to `/api/proof` or `/api/judge-proof`
when `LEPTONWEB_DEPLOY_COMMIT` is unset.

Exploit path: `citations/src/lib/proof-pack.ts:12-25` executes
`git rev-parse HEAD` while building each proof. Both public routes call
`buildProofPack`.

Impact: process-spawn exhaustion and avoidable latency.

Fix: cache the commit lookup once per process or require the deployment commit
to be injected at build/runtime.

Regression test: repeated proof builds invoke the Git lookup at most once.

Remediation evidence: `citations/src/lib/proof-pack.ts` caches the fallback
lookup in a module-level Promise, and
`citations/src/lib/proof-pack.test.ts` confirms two builds spawn
`git rev-parse` once.

### TG-SEC-024 — Public proofs expose internal URLs and conditional host paths

Severity: **LOW**  
Status: **FIXED**

Trust boundary: internal service topology crosses into public proof JSON.

Attacker input: a public proof request.

Exploit path:

- `aperture/src/lib/proof-pack.ts:50-57` includes
  `APERTURE_IMMICH_API_BASE_URL`, whose default is a loopback URL.
- EXIF `sourcePath` can be stored at `aperture/src/lib/ledger.ts:178-180` and
  returned through the raw ledger. No current tracked receipt contains this
  field.
- The tracked Citations ledger contains a private/loopback
  `trackRecord.evidenceUri` which raw proof/ledger/receipt serializers expose.

Impact: internal IP/path disclosure and violation of the documented no-raw-IP
proof boundary.

Fix: omit internal endpoint and host-path fields from public proof projections
and redact historical public views without mutating stored records.

Regression test: sentinel loopback/private URLs and host paths do not occur in
public proof JSON.

Remediation evidence: Aperture's proof pack omits the internal Immich base and
both applications apply their public-data projections to proof/ledger output.
`citations/src/lib/public-data.test.ts`,
`aperture/src/lib/public-data.test.ts`,
`citations/src/app/api/ledger/route.test.ts`,
`citations/src/app/api/receipts/[hash]/route.test.ts`, and
`aperture/src/lib/proof-pack.test.ts` cover private URL/path removal without
changing stored records.

### TG-SEC-025 — Wallet case variants split one creator into multiple rows

Severity: **LOW**  
Status: **FIXED**

Trust boundary: an unchecksummed source wallet crosses into public creator
aggregation.

Attacker input: the same 20-byte wallet registered with different letter case.

Exploit path: registration preserves casing, while
`citations/src/lib/ledger.ts:632-681` keys creator rows by the exact receipt
wallet. Other wallet-summary joins correctly lowercase.

Impact: duplicate leaderboard rows and misleading creator totals. No
cross-wallet private-data leak was found. Current data has no mixed-case
duplicate groups.

Fix: aggregate public and historical data by lowercased address while returning
a stable display address. Registration still preserves the submitted casing.

Regression test: case variants produce one creator row and the same total.

Remediation evidence: `citations/src/lib/ledger.ts` keys creator aggregation
and source-count joins by lowercase wallet while retaining one display value.
`citations/src/lib/settlement.test.ts` covers mixed-case historical receipts
collapsing into one creator row.

### TG-SEC-026 — Setup/proof CLIs print operator-only wallet identifiers

Severity: **LOW**  
Status: **FIXED**

Trust boundary: server-only Circle wallet identifiers cross into terminal logs
and copied proof output.

Evidence:

- `citations/scripts/prove-w3s-source.mjs:19-30`
- `citations/scripts/prove-w3s-paid-query.mjs:25-37`
- `citations/scripts/circle-create-wallets.mjs:54-73`
- `aperture/scripts/register-creator.ts:32-50`

No tracked generated proof document currently contains a wallet ID.

Impact: unnecessary custody-metadata exposure in shell history, CI logs, or
copied support output.

Fix: print public addresses and stable operation IDs only; redact Circle
wallet/wallet-set IDs.

Regression test: captured CLI output does not contain sentinel wallet IDs.

Remediation evidence: the three Citations scripts and Aperture creator
registration script now print public addresses or stable operation messages
without wallet/wallet-set IDs.
`citations/src/lib/cli-redaction.test.ts` and
`aperture/src/lib/cli-redaction.test.ts` inspect captured output with private
sentinels.

### TG-SEC-027 — Raw refund errors may persist secret-bearing upstream text

Severity: **LOW**  
Status: **FIXED (DEFENSIVE HARDENING)**

Trust boundary: a raw provider/RPC error may cross into the public ledger.

Evidence: `citations/src/lib/settlement.ts:650-669` stores
`error.message` in `refundFailure`, and public proof/ledger/receipt routes
return queries containing this field.

Why unconfirmed: the current ledger contains no `refundFailure` record, and no
reachable provider error containing credentials or an internal path was
demonstrated.

Hardening fix: persist only stable public failure text; never persist or return
the raw upstream error.

Regression test: static source inspection verifies that the refund boundary
does not persist `error.message` and does use the stable public failure text.

Remediation evidence: `citations/src/lib/settlement.ts` now persists fixed
refund-failure messages. `citations/src/lib/settlement.test.ts` reads that
source boundary and asserts `error.message` is absent.

### TG-SEC-028 — PayGate does not sign the concrete split array

Severity: **INFO**  
Status: **ACCEPTED-INFO**

`UseIntent` signs `selectedSourcesRoot`; `PayGate.payWithIntent` accepts a
caller-chosen `SplitPayment[]`, verifies its sum against the cap, then routes
it. The immutable payer gate prevents an external copier from substituting
recipients, and a compromised authorized payer can already call the FeeRouter.
This is therefore a documented signer/payer trust boundary, not a third-party
fund-stealing exploit.

If future requirements separate the signer and payer trust domains, a v2
intent should bind a payments root and require proofs for each split.

### TG-SEC-029 — Core dependency baseline and package-specific audit scope

Severity: **INFO**  
Status: **VERIFIED-INFO**

The frozen baseline audit for Citations, Aperture, and pay-per-piece reported
zero production advisories. The x402 peer dependencies in pay-per-piece remain
exactly pinned to `2.17.0`, and the reviewed install scripts were limited to
expected platform/build packages (`esbuild`, `fsevents`, and `sharp`).

That initial statement did not cover every adapter lockfile. The expanded
package audit found the PeerTube `ws` advisory recorded separately as
TG-SEC-036. After its exact viem pin, final audits report zero vulnerabilities
for Citations, Aperture, Jellyfin, PeerTube, WordPress, MCP, SDK,
pay-per-piece, and the toy paywall example.

### TG-SEC-030 — PayGate verification input has a newline reproducibility mismatch

Severity: **INFO**  
Status: **VERIFIED-INFO**

Both contracts compile with solc 0.8.35, optimizer 200, Cancun, with zero
errors/warnings. Read-only Arc checks matched runtime sizes, immutable values,
and EIP-712 domain values. `citations/verification/PayGate.standard.json`
contains LF source while the working/deployed source uses CRLF, explaining the
already-documented partial metadata mismatch.

No security-sensitive bytecode mismatch was found.

### TG-SEC-031 — Ignored local Circle credentials require owner custody review

Severity: **INFO**  
Status: **OPERATOR-ACTION**

`citations/.env.local` exists, is ignored, and contains non-empty Circle
configuration. No value was displayed or copied. The tracked tree scan found no
Anthropic, Resend, AWS access-key, Stripe-live, PEM private-key, or mnemonic
pattern.

Operator action: confirm the local file remains outside backup/sharing paths
and decide whether the Circle material should be rotated. Previously disclosed
Anthropic/Resend secrets remain an owner rotation action; this audit did not
find them in the current working tree.

### TG-SEC-032 — Immich licensing could double-pay and lacked a durable payment journal

Severity: **CRITICAL**  
Status: **FIXED**

Trust boundary: a paid archive request crossed from x402 settlement into a
separate creator payout, receipt append, and delivery authorization without a
durable identity tying those steps together.

Baseline exploit/failure path:

- `aperture/src/lib/license-download.ts` settled x402 and could then perform a
  second operator-funded FeeRouter transfer.
- A time-bucketed receipt identity could collide across buyers, while a retry
  after a post-payment failure could create another transfer.
- There was no durable reserve/settled/receipted record to distinguish a
  definite pre-settlement failure from an ambiguous or completed payment.

Impact: duplicate creator payment, collector-to-creator fund loss, or a buyer
being charged without recoverable access.

Remediation: `aperture/src/lib/license-download.ts` now sends x402 directly to
the one approved payout wallet, derives a canonical payment identity, binds it
to the complete current license snapshot, and uses
`aperture/src/lib/license-purchase.ts` for atomic SQLite
`reserved -> settled -> receipted` transitions. Receipt IDs bind the payment,
link, and asset. A receipt-store outage leaves the journal settled, returns
paid access with `receiptStatus: pending`, and resumes the receipt without
settling again.

Regression evidence:
`aperture/src/lib/license-download-payment.test.ts`,
`aperture/src/lib/license-purchase.test.ts`, and
`aperture/src/lib/x402-server.test.ts`.

Residual risk: if x402 succeeds but the process cannot persist
`markSettled`, the row remains reserved and automatic retries return 409
rather than risking a second settlement. Operator reconciliation is required
for that narrow crash/storage-failure window.

### TG-SEC-033 — Immich archive authorization was reusable and bypassable

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: browser-controlled shared-link credentials and a reusable
authorization crossed into Immich's archive endpoint.

Baseline exploit path:

- Historical receipts could satisfy the license check instead of a fresh,
  request-scoped authorization.
- The boundary covered the query `key` path but not Immich's alternate `slug`,
  `X-Immich-Share-Key`, and `X-Immich-Share-Slug` credential forms. Immich
  v2.7.5 accepts those forms in its
  [official auth service](https://raw.githubusercontent.com/immich-app/immich/v2.7.5/server/src/services/auth.service.ts).
- The authorization was not durably single-use or bound to the complete
  current archive body.

Impact: replay or alternate-credential bypass of the paid archive boundary.

Remediation:

- `aperture/src/lib/license-authorization.ts` signs the key hash, shared-link
  ID, sorted complete asset hash, POST method, expiry, and nonce, and atomically
  reserves/completes/releases the token in SQLite.
- `aperture/src/lib/license-archive.ts` re-resolves the current link, requires
  the exact complete body, and performs the trusted Immich request
  server-side.
- `aperture/src/lib/license-check.ts` and both nginx templates reject every
  client-supplied shared credential on direct archive paths and strip those
  credentials before proxying.

Regression evidence:
`aperture/src/lib/license-authorization.test.ts`,
`aperture/src/lib/license-archive.test.ts`,
`aperture/src/app/api/license-archive/route.test.ts`,
`aperture/src/lib/license-check.test.ts`, and
`aperture/src/lib/nginx-config.test.ts`.

Residual risk: process death after token reservation but before completion can
strand that paid one-use token until it expires. Caught upstream failures
release it; crash-recovery leasing is not yet implemented.

### TG-SEC-034 — Archive eligibility/body mismatches enabled unpaid or unsafe routing

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: partially validated Immich metadata and caller-selected asset
IDs crossed into pricing and payout routing.

Baseline exploit path: album/view-only links were not rejected uniformly,
caller-selected subsets could differ from the current shared link, unresolved
owners could be skipped, and collector routing could separate buyer payment
from creator payment.

Impact: unpaid assets in a licensed archive, underpayment, or a successful
collector charge followed by failed creator delivery.

Remediation: `aperture/src/lib/immich.ts` accepts only downloadable,
unpassworded `INDIVIDUAL` links. `aperture/src/lib/license-download.ts` and
`aperture/src/lib/license-archive.ts` require the exact complete asset set,
every owner to have an approved mapping, and exactly one payout wallet. A
multi-photographer archive fails closed until atomic split settlement exists.
The x402 requirement pays that wallet directly.

Regression evidence: `aperture/src/lib/immich.test.ts`,
`aperture/src/lib/license-download.test.ts`,
`aperture/src/lib/license-download-payment.test.ts`, and
`aperture/src/lib/license-archive.test.ts`.

### TG-SEC-035 — Jellyfin live settlement lacked crash-safe journaling

Severity: **CRITICAL**  
Status: **FIXED-BY-CONTAINMENT**

Trust boundary: server-verified playback crossed into an operator-funded
transfer before durable receipt persistence.

Baseline failure path: live mode settled before appending its ledger receipt,
used only process-local serialization, derived event identity partly from
caller-variable playback data, and could fall back to signer variables shared
with another Tollgate service. A crash or append failure could therefore make
the same event payable again after restart.

Remediation: the original anonymous registration and untrusted-playback issues
from TG-SEC-007 are fixed, but `jellyfin-sidecar/src/config.ts` now rejects
every fully configured live/forum-routed startup until durable pre-payment
journaling and reconciliation are implemented. It accepts only the dedicated
`JELLYFIN_FEE_ROUTER_PRIVATE_KEY` namespace and ignores Leptonweb/Aperture
signer variables. Public proof retains honest historical evidence while
reporting current `liveSpendEnabled: false`.

Regression evidence: `jellyfin-sidecar/tests/sidecar.test.ts`; the full
Jellyfin suite passes 36/36 with typecheck and build.

Operator action: do not re-enable live settlement by weakening this guard.
Implement and review a restart-safe payment journal and reconciliation
workflow first.

### TG-SEC-036 — PeerTube installed advisory-affected `ws@8.20.1`

Severity: **HIGH (UPSTREAM)**  
Status: **FIXED**

The baseline PeerTube lockfile resolved `viem` to a dependency graph containing
`ws@8.20.1`, affected by
[GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p).
The reviewed plugin uses viem's HTTP transport, so this audit did not
demonstrate a reachable public WebSocket exploit path; the vulnerable package
was nevertheless shipped in the production graph.

Remediation: `peertube-plugin-tollgate/package.json` pins `viem` exactly to
`2.55.2`, and the lockfile resolves `ws@8.21.0`. The dependency regression in
`peertube-plugin-tollgate/test/tollgate.test.mjs` asserts all three versions.
The plugin passes 18/18 tests, package dry-run, and an audit with zero
vulnerabilities.

### TG-SEC-037 — Generic link downloads could charge before durable delivery

Severity: **HIGH**  
Status: **FIXED**

Trust boundary: a generic BYO-link/upload x402 settlement crossed into media
fetching, optional collector forwarding, and receipt persistence without a
durable payment identity.

Baseline failure path: the route could settle before reading/fetching the full
media, then return 502 and require another payment; it used random event IDs,
had no restart-safe journal, and optionally charged a collector before a
second FeeRouter payout.

Remediation:

- `aperture/src/lib/x402-server.ts` runs the media load only after payment
  verification and before Gateway/facilitator settlement.
- `aperture/src/lib/link-download.ts` pays the approved creator directly,
  binds the canonical payment identity to the immutable link snapshot, reuses
  the SQLite purchase journal, and derives a deterministic receipt ID.
- A receipt outage serves the already-paid bytes with
  `x-aperture-receipt-status: pending`; retrying the same payment resumes
  receipt persistence without another settlement.

Regression evidence: `aperture/src/lib/link-download.test.ts`,
`aperture/src/app/api/links/[id]/download/route.test.ts`, and the Gateway
verify/media/settle ordering test in
`aperture/src/lib/x402-server.test.ts`.

Residual risk: the same post-settlement `markSettled` storage-failure window
described in TG-SEC-032 requires operator reconciliation and deliberately
fails closed against automatic resettlement.

## Explicitly checked surfaces with no additional finding

The following checks found no issue beyond the numbered findings above. They
are not a blanket certification of an entire workstream.

### WS-A — secrets, keys, and signing material

- Circle API/entity secrets are environment-only in both applications.
- The Circle entity secret is encrypted with RSA-OAEP/SHA-256 before API use.
- No private key or mnemonic is serialized into either proof pack or ledger.
- Aperture session/signup HMAC fails closed when its secret is absent and uses
  constant-time comparison.
- Account keys and login tokens use 32 random bytes and store only hashes.
- Case-sensitive tracked-tree and full Git-history scans found no provider
  token, private-key material, Stripe-live key, or mnemonic candidate.

### WS-B — payment, escrow, and nonce paths

- Official facilitator/Gateway x402 paths verify and settle before returning
  `x402-settled`.
- Settlement-mode labels remain distinct; local verification is not mislabeled
  as settled.
- Aperture archive and generic-link payments now use a durable canonical
  payment identity and snapshot-bound journal before settlement.
- Jellyfin live settlement is intentionally unavailable until its own durable
  pre-payment journal exists.
- Escrow remains default-on:
  `TOLLGATE_ESCROW_UNVERIFIED !== "0"`.
- Normal Citations FeeRouter payouts validate split totals, available balance,
  transaction status, and evidence events.
- The pay-per-piece nonce queue and payout receipt checks are sound prior art.

### WS-C — SSRF and untrusted content

- Both safe-fetch implementations reject non-HTTP(S) schemes, credentials in
  URLs, IPv4 private/loopback/link-local ranges, IPv6 loopback/link-local/ULA
  ranges, and metadata address `169.254.169.254`.
- Redirects are manual and each redirect URL is revalidated.
- Aperture already rejects dotted and hex-form IPv4-mapped IPv6 literals.
- Catalog registration and discovery content readers enforce byte caps and
  strip active HTML before storage.
- Reviewed trusted-internal fetches are not reachable with a caller-selected
  origin.

### WS-D — Aperture authentication and authorization

- Session cookies are HttpOnly, Secure in production, and SameSite=Lax.
- Session HMAC and signup HMAC comparisons are constant-time.
- Account mutation routes derive `ownerId` from the session rather than the
  body.
- Linked wallets validate EVM address shape, deduplicate case-insensitively,
  cap at ten, exclude the native wallet, and grant read-only aggregation.
- Login-link request responses are anti-enumerating and the email-send route
  has an explicit host allowlist.

### WS-E — public proof and API boundaries

- Citations `/api/sources` GET/POST and creator summary routes apply the
  existing source sanitizer.
- Citations proof source projection enumerates fields and omits
  `notifyEmail`, `walletId`, and ownership proof.
- Aperture creator/link/browse projections omit `walletId`, email,
  `accountKeyHash`, login-token hashes, linked wallets, and ownership proof.
- Aperture download receipts persist only a raw access-log hash; raw IP and
  user-agent values are not stored in the public ledger.
- No raw access token, private key, mnemonic, or user-agent field was found in
  current tracked proof data.

### WS-F — smart contracts

- The EIP-712 domain binds chain ID and verifying contract.
- The signed intent covers all eight current intent fields.
- Signatures enforce lower-half-order `s`, reject zero recovered signers,
  enforce expiry, and consume nonces.
- PayGate restricts the caller to the immutable payer.
- Spend-cap checks precede external interactions.
- ERC-20 approve/transfer return values are checked and the transaction is
  atomic on downstream failure.
- No unchecked arithmetic or exploitable reentrancy path was found.
- Both deployed runtime sizes and immutable values matched the locally compiled
  contracts in read-only verification.

### WS-G — injection, rate limits, and denial of service

- Dynamic wallet routes validate 20-byte EVM addresses before lookup.
- Source IDs, receipt hashes, post IDs, and adapter item IDs are used as
  structured store keys, not joined directly into caller-controlled filesystem
  paths or shell commands.
- No catastrophic-backtracking regular expression was confirmed on an
  untrusted input path.
- Discovery fan-out and imported item counts are bounded.
- Existing error handlers do not emit stack traces.

### WS-H — dependencies and supply chain

- Final production dependency audits returned zero advisories after the
  PeerTube dependency remediation in TG-SEC-036.
- x402 peers remain exact-pinned at the installed `2.17.0`.
- No suspicious new install script was found in the reviewed lockfiles.

## Verification baseline

The following passed before any remediation:

- Citations: 51 test files, 291 tests.
- Aperture: 49 test files, 231 tests.
- Jellyfin sidecar: 10 tests, typecheck, and build.
- pay-per-piece: 26 tests, typecheck, and build.
- MCP: 7 tests, typecheck, and build.
- SDK: 3 tests, typecheck, and build.
- PeerTube plugin: 5 tests.
- WordPress plugin: 4 static checks.
- Citations ledger: 171 queries and 474 receipts verified.
- Aperture ledger: 4 receipts verified.
- Fresh production builds passed for both Next.js applications.
- Solidity contracts compiled with solc 0.8.35, optimizer 200, Cancun, with
  zero errors and zero warnings.

## Final remediation verification

Local gates completed on 2026-07-17:

- Citations: 63 test files and 345 tests passed; typecheck and the Next.js
  production build passed; `npm audit` reported zero vulnerabilities; 171
  queries and 474 receipts verified with zero ledger issues.
- Aperture: 64 test files and 314 tests passed; typecheck and the Next.js
  production build passed; `npm audit` reported zero vulnerabilities; 4
  receipts verified with zero ledger issues.
- Jellyfin sidecar: 36/36 tests, typecheck, build, and zero-vulnerability audit
  passed.
- PeerTube plugin: 18/18 tests, zero-vulnerability audit, and package dry-run
  passed with `viem@2.55.2` and `ws@8.21.0`.
- WordPress plugin: 5/5 static tests, ZIP content verification, and both
  available PHP-WASM/Playground smoke paths passed; its audit reported zero
  vulnerabilities.
- MCP: 7/7 tests, typecheck, build, package dry-run, and zero-vulnerability
  audit passed.
- SDK: 3/3 tests, typecheck, build, and zero-vulnerability audit passed.
- pay-per-piece: 26/26 tests, typecheck, build, package dry-run, and
  zero-vulnerability audit passed; its toy example passed 6/6 tests and a
  zero-vulnerability audit.
- Both concrete Solidity contracts compiled with solc 0.8.35, optimizer 200,
  Cancun, and emitted bytecode successfully.
- `git diff --check` passed. Generated SQLite and stale Next.js cache artifacts
  are ignored and are not part of the proposed change set.

External verification limitations:

- `npm run judge:verify` reached all three public Tollgate endpoints with HTTP
  200 but the Arc RPC returned HTTP 429 on both attempts before individual
  checks completed. Local ledger, contract, test, and build gates remain green;
  this is not recorded as a successful live judge verification.
- Docker is unavailable in this Windows environment. The WordPress
  PHP-WASM/Playground fallback passed, but no Docker-specific smoke test is
  claimed.

## Residual risks and operator actions

1. Deploy the reviewed worktree through the normal change-control process; no
   live service currently benefits from these uncommitted fixes.
2. Reconcile historical `creator-claimed` escrow releases and WordPress,
   PeerTube, Jellyfin, and Aperture adapter payouts for duplicates or
   attacker-selected recipients.
3. TG-SEC-022 requires a new executor-bound registry/PayGate deployment if the
   nonce front-run denial of service is to be removed.
4. TG-SEC-031 requires owner review of ignored local Circle material and
   previously disclosed Anthropic/Resend rotation status.
5. Keep Jellyfin live settlement disabled until a durable pre-payment journal
   and restart-safe reconciliation workflow pass review.
6. Aperture deliberately fails closed on the narrow
   settlement-success/`markSettled` storage-failure window; operators need a
   reconciliation procedure. A process crash after archive-token reservation
   can strand that token until expiry.
7. Rerun the live judge verifier after the Arc RPC throttle window clears.

No commit, push, pull request, deployment, key rotation, transaction, or
submission was performed or authorized by this report.
