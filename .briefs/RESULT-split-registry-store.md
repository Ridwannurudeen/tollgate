# Result: FeeRouter split registry store

## What changed

- Added `docs/SCOPE-SPLIT-REGISTRY-STORE.md` before implementation. It defines
  the optional atomic `SplitRegistryStore.getOrInsert()` contract, its legacy
  two-method fallback, the crash-ordering rule, and the boundary between the
  default file store and a future database backend.
- Extended `pay-per-piece/src/split-registry.ts` with a normalized split key,
  atomic get-or-insert result, identity matching, and optional creation and
  existing-record verification callbacks. Existing `read()`/`write()` stores
  continue through the original process-local fallback.
- Extended `pay-per-piece/src/stores/file.ts` with durable per-tuple pending
  claims and a short exclusive append lock. Same-process contenders share the
  winning promise; another process that encounters an unresolved claim fails
  closed for reconciliation instead of submitting another on-chain split.
- Kept the primary registry bytes unchanged: it is still the same formatted
  `{ "splits": [...] }` JSON parsed by `parseFeeRouterSplitRegistry`. Coordination
  state lives in sibling paths.
- Added SDK coverage for the optional atomic path, concurrent same-tuple reuse,
  ambiguous-failure reservation, concurrent different-tuple appends, and the
  unchanged registry JSON representation.
- Bumped `tollgate-pay-per-piece` and its lockfile to `0.1.3`. No publish command
  was run.
- Linked citations to the local SDK package and made its test, typecheck, and
  build scripts build that package first.
- Replaced citations' private registry parser, read/write helpers,
  `splitRegistryLock`, and local `ensureCreatorSplit` with the SDK store and SDK
  orchestration. Citations retains only its chain-specific create and verify
  callbacks so all writes continue through its existing nonce allocator and
  configurable `viem` 2.52.0 client.
- Updated the proof pack to read through the shared SDK-backed store.

## Design decision

The store claims `(tenantId, wallet, recipients, bps)` before invoking the
on-chain callback. An ambiguous error leaves the claim pending. This is stricter
than retrying: a retry after broadcast but before the registry write could spend
gas twice and create two real splits, so recovery must inspect the chain before
the claim is cleared.

The file store coordinates cooperating processes on one host through exclusive
filesystem creation and serializes final appends so different tuples cannot
clobber one another. It does not claim correctness across independent hosts or
network filesystems. A real multi-host backend still needs a unique normalized
key plus a durable pending/created state machine; a unique final row alone does
not close the ambiguous-chain-transaction window.

## Verification observed

Final verification was run from this worktree on 2026-08-24 with test temporary
paths redirected under `.briefs/`:

- `pay-per-piece/npm test`: **4 test files passed, 31 tests passed**.
- `pay-per-piece/npm run typecheck`: **exit 0**.
- `pay-per-piece/npm run build`: **exit 0** during implementation and through
  the citations pretest/pretypecheck hooks.
- `citations/npm test`: **67 test files passed, 396 tests passed**.
- `citations/npm run typecheck`: **exit 0**.
- `git diff --check d222f62...HEAD`: **exit 0**.
- The changed-path audit from `d222f62...HEAD` contained no path under `data/`.

## Limits and assumptions

- This checkout contained no existing `docs/SCOPE-*.md` files; the pattern is
  ignored by `.gitignore`. The new scope document was force-added because the
  brief requires it, and its tone follows `docs/ROADMAP.md` and
  `docs/RECIPE-PAYMENT-GATE.md` instead.
- The existing live registry was not opened or modified. Compatibility was
  verified against the parser and byte-format tests, not against production
  contents.
- The old citations-only test that assigned a missing `tenantId` to
  `citations-core` was removed with the private parser. The SDK parser requires
  the explicit tenant field, matching the brief's verified statement that live
  records already carry `tenantId`.
- `pay-per-piece/package-lock.json` was already modified at session start to
  match the package name and 0.1.2 version. That existing correction was
  preserved while advancing the lockfile to 0.1.3.
- Pending file claims and stale write locks require operator reconciliation
  after a crash. Automatic age-based cleanup is deliberately not implemented,
  because elapsed time does not prove that no chain transaction was broadcast.
- Nothing was pushed, merged, published, deployed, or submitted.
