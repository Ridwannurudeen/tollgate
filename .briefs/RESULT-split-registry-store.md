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
- Kept the primary registry schema unchanged: it is still the same formatted
  `{ "splits": [...] }` JSON parsed by `parseFeeRouterSplitRegistry`. A normalized
  legacy write adds the resolved `tenantId`; coordination state lives in sibling
  paths.
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
- During the original split-store work, the live registry was not opened or
  modified; compatibility was checked only against the then-current parser and
  format tests. The corrective brief established that production records omit
  `tenantId`, and the corrective coverage below now uses that legacy shape.
- The old citations-only test that assigned a missing `tenantId` to
  `citations-core` was removed with the private parser. That lost behavior is
  restored below through the SDK's caller-explicit legacy tenant option.
- `pay-per-piece/package-lock.json` was already modified at session start to
  match the package name and 0.1.2 version. That existing correction was
  preserved while advancing the lockfile to 0.1.3.
- Pending file claims and stale write locks require operator reconciliation
  after a crash. Automatic age-based cleanup is deliberately not implemented,
  because elapsed time does not prove that no chain transaction was broadcast.
- Nothing was pushed, merged, published, deployed, or submitted.

## Corrective fix: legacy tenant attribution

- Added the explicit `legacyTenantId` parser/store option. Only an absent or
  blank stored `tenantId` uses it; present non-string, overlong, and otherwise
  malformed records still fail the existing validation.
- Configured every Citations file-store construction with
  `legacyTenantId: "citations-core"`. The SDK remains tenant-neutral for external
  integrators.
- Restored Citations coverage for the production legacy shape with the
  `tenantId` key absent and verified that payout routing reuses the stored split
  instead of invoking `createSplit`.
- Added an SDK regression fixture containing 12 valid legacy records with no
  `tenantId` keys. Its read → existing `getOrInsert` → write round trip retains
  all 12 records, invokes the insert callback zero times, and persists
  `tenantId: "citations-core"` on every normalized record. A separate test covers
  the empty-string legacy form.

Final verification was rerun sequentially from this worktree on 2026-08-24:

- `pay-per-piece/npm test`: **4 test files passed, 32 tests passed**.
- `pay-per-piece/npm run typecheck`: **exit 0**.
- `citations/npm test`: **67 test files passed, 397 tests passed**.
- `citations/npm run typecheck`: **exit 0**.

An earlier parallel full-suite run caused the unrelated Citations
`proof-pack.test.ts` Git-subprocess test to exceed its 5-second timeout. The test
passed alone (**3 tests passed**) and the complete Citations suite then passed
when rerun sequentially as reported above.
