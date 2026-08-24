# Result: merge split registry store

## Conflict resolution

- Merged `feat/split-registry-store` at `34f84b0` into
  `feat/fee-router-key-hardening` at `9cf10ce`.
- In the constant block, kept one
  `DEFAULT_FEE_ROUTER_TENANT_ID = "citations-core"` declaration before the
  default store construction. Removed the incoming
  `STANDING_FEE_ROUTER_ALLOWANCE` block so citations continues to calculate
  FeeRouter and PayGate approvals with `feeRouterAllowanceTarget()`.
- In `routeEscrowReleasePayment`, kept the lifecycle-managed
  `withFeeRouterSigner()` operation, strict allowance target, reserved nonces,
  receipt checks, and returned evidence from the hardening branch. Integrated
  the incoming store-based `ensureCreatorSplit()` call and constructed a
  path-specific store with
  `legacyTenantId: DEFAULT_FEE_ROUTER_TENANT_ID`.
- Verified all three citations store construction sites use that same explicit
  legacy tenant: the default store, `prepareCitationSplit`, and
  `routeEscrowReleasePayment`.
- Verified the five application signer operations remain lifecycle-controlled:
  citation routing, escrow release, reader refund, PayGate settlement, and
  external-provider payment use `withFeeRouterSigner`; key rotation remains
  guarded by `blockFeeRouterSignerOperations` and retires outgoing and incoming
  nonce state.

No test was weakened, deleted, or changed during conflict resolution. The test
changes in the merge are the incoming branch's unmodified regression coverage.
`pay-per-piece/src/split-registry.ts` and `pay-per-piece/src/stores/file.ts` were
not manually modified; their merged contents are exactly the incoming commit.

## Verification observed

- `pay-per-piece/npm test`: passed; 4 test files and 32 tests passed. This
  includes the 12-record legacy registry round-trip test, which verified that
  every record loads as `citations-core`, persists without loss, and does not
  invoke duplicate creation.
- `pay-per-piece/npm run typecheck`: passed
  (`tsc -p tsconfig.json --noEmit`).
- `citations/npm test`: passed after its SDK prebuild; 70 test files and 418
  tests passed. `proof-pack.test.ts` passed on the first run.
- `citations/npm run typecheck`: passed after its SDK prebuild
  (`tsc --noEmit`).
- `git diff --cached --check`: passed with the result brief staged.

## Not verified or performed

- The live `/opt/tollgate/data/fee-router-splits.json` file was not read because
  it is outside the permitted worktree. Its described 12-record legacy shape
  was verified through the incoming test fixture instead.
- No production data was read or changed. No live transaction, deployment,
  push, publish, or merge to `leptonweb-mvp` was performed.
