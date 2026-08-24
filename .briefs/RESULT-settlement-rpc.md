# Settlement RPC result

## What changed

- Added the server-only `ARC_SETTLEMENT_RPC_URL` setting. When it is absent or empty, settlement still constructs the same `http(ARC_RPC_URL)` transport used before this change.
- Isolated the environment read in `citations/src/lib/settlement-rpc.server.ts`, guarded by the `server-only` marker package. `chain.ts` and `arcChain` remain client-safe and continue to expose only `NEXT_PUBLIC_ARC_RPC_URL`.
- The authenticated transport keeps its private viem request inside the server-only module while exposing only the public Arc URL through client transport metadata. Viem moves embedded Basic-auth credentials into an `Authorization` header. Invalid URLs fail without echoing the value, and every field in a thrown transport error is URL-redacted before it leaves the module.
- Added a narrowly gated retry around x402 facilitator submission methods. It matches only a viem `BaseError` chain containing `LimitExceededRpcError` whose normalized details are exactly `rate limit exceeded`. `writeContract` and the EIP-6492 `sendTransaction` path get three total attempts with 250 ms and 500 ms backoff. Other errors are not retried.
- Changed x402 raw-error logging to redact URLs whenever the private endpoint is configured. The final thrown error and exact-settlement failure reason are also sanitized before they can escape.

## Call-site decision

Seven of the eleven `citations/src/lib` transports moved:

- `x402-server.ts`: moved the facilitator's combined wallet/public client. This is the incident path and keeps facilitator reads and submission on its one transport.
- `fee-router.ts`: moved both `createFeeRouterPublicClient()` and the keystore wallet client. The public client supplies pending nonce reads, simulations, receipt waits, and settlement reads; the wallet client submits.
- `use-intent.ts`: moved both the public client and wallet client used by `anchorUseIntent()`.
- `track-record.ts`: moved both the public reporting client and the wallet client used by `publishTrackRecordForAnswer()` because that flow reads state before writing and waits for its receipts.

Four read-only/reporting transports remain on the public endpoint:

- `covenant.ts`: covenant snapshot reads.
- `forum.ts`: liveness/reporting reads.
- `peertube-proof.ts`: historical transaction proof reads.
- `slash-bond.ts`: public status reads.

## Nonce-view consistency

The default keystore FeeRouter nonce view and submission view both call the same `settlementTransport()` factory. Tests instantiate `createFeeRouterPublicClient()` and `createFeeRouterSigner()` together, verify that both transports resolve through the authenticated endpoint, and verify that the secret URL is used only by the private fetch layer. `use-intent` likewise uses the same factory for its pending-nonce public client and wallet client. The x402 facilitator remains one `createWalletClient(...).extend(publicActions)` client, so its read and write actions cannot select different transports.

The W3S FeeRouter mode is different: Circle W3S owns transaction submission and the existing adapter does not pass through the locally reserved nonce. Its remote node/mempool is not operator-selectable, so same-node behavior cannot be verified for W3S. The invariant above applies to the direct viem/keystore settlement path affected by the two FeeRouter RPC call sites in this brief.

## Secret containment

- The private variable is not `NEXT_PUBLIC_*` and is read only from a module marked `server-only`.
- A production Next.js build with a synthetic credential marker succeeded; neither the marker nor `ARC_SETTLEMENT_RPC_URL` appeared in `.next/static` browser chunks.
- Client transport metadata exposes only the public Arc URL. The private viem transport remains inside the server-only wrapper, and viem removes Basic-auth userinfo before calling `fetch`.
- HTTP, network, and JSON-RPC failures are walked recursively and every URL-bearing string is redacted before the error is rethrown, while preserving viem's error classes for the retry predicate.
- x402 log inspection replaces HTTP(S) URLs with `[redacted rpc url]` while preserving the diagnostic details and cause text. Configured-endpoint thrown errors and exact-settlement response reasons are sanitized as well.
- Tests cover logs, thrown errors, the response-reason sanitizer used by exact settlement, Basic-auth handling, upstream RPC error text and headers, and fetch failures.

## Verification

- `citations/`: `npm test` — 75 files, 446 tests passed.
- `citations/`: `npm run typecheck` — passed.
- `pay-per-piece/`: `npm test` — 4 files, 32 tests passed.
- `pay-per-piece/`: `npm run typecheck` — passed.
- `citations/`: `npm run build` — production build passed.
- Synthetic secret scan of `citations/.next/static/**/*.js` — no marker or environment-variable name found.
- `proof-pack.test.ts` passed in both full citations runs; the known timeout flake did not occur.
- `git diff --check` — passed before the final report was written.
- No file under a `data/` directory was modified or created.

## Not verified

- No real authenticated Arc provider URL was available in the worktree, so no live RPC request or transaction was sent. Transport routing is covered with mocked fetch calls only.
- Circle W3S's remote node and mempool selection cannot be controlled or inspected from this codebase, as described above.
