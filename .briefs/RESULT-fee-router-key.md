# Result: FeeRouter key hardening

## Changed

- Added `docs/SCOPE-FEE-ROUTER-KEY.md` with the five actual signer call sites,
  the unused production W3S seam, the verified allowance/balance exposure, a
  numeric testnet operating boundary, W3S limitations, and explicit multisig
  and HSM exclusions.
- Replaced the 10,000-USDC flat approval with a strict fixed 1-USDC per-spender
  ceiling. Oversized operations fail before chain writes, concurrent approvals
  write the same target, and the next settlement normalizes the live legacy
  allowance down to policy.
- Added keystore rotation that drains admitted in-process signer work through
  receipt confirmation, revokes outgoing FeeRouter and configured PayGate
  allowances, retires outgoing and incoming nonce caches, and activates the
  incoming key only after successful revocation.
- Added `npm run prepare:fee-router-key-rotation` as an offline preparation
  command. It refuses while `LEPTONWEB_INTERNAL_ORIGIN` is listening, never
  prints or persists either key, revokes old allowances, and reports that the
  operator must still update persistent configuration and restart.
- Added regression coverage for strict allowance parsing, legacy allowance
  normalization, per-operation ceilings, signer draining, failed rotation,
  W3S/use-intent guards, address-scoped nonce retirement, and the offline
  listener boundary.

## Verification observed

- `pay-per-piece/npm test`: 4 test files passed, 31 tests passed.
- `pay-per-piece/npm run typecheck`: passed (`tsc -p tsconfig.json --noEmit`).
- `citations/npm test`: 70 test files passed, 417 tests passed.
- `citations/npm run typecheck`: passed (`tsc --noEmit`, after rebuilding the
  local `pay-per-piece` package).
- Targeted rotation/offline-preflight suite: 2 files passed, 6 tests passed.
- Targeted allowance suite: 3 files passed, 45 tests passed.
- `git diff --check`: passed for the task files before each commit.
- Read-only Arc RPC check at block `58,595,805`: payer balance
  `16,854,268` atomic USDC and FeeRouter allowance `9,999,791,500` atomic USDC.

## Commits

- `79eda22 limit fee router approval exposure`
- `43a9873 make fee router key rotation drain-safe`
- `d9b1685 normalize legacy fee router approvals`
- `7358850 require offline fee router rotation prep`
- `fcdace4 document fee router signer risk boundary`

## Not verified or performed

- The live `/etc/tollgate.env` signer-mode finding was supplied as verified in
  the brief but was not independently re-read because this task was restricted
  to the worktree.
- No live key rotation, allowance revocation, W3S switch, transaction, deploy,
  push, merge, or service restart was performed.
- Safe or another multisig factory deployment on Arc testnet remains
  unconfirmed; no multisig or HSM infrastructure was built.
- The corrective fix described as landing separately on
  `feat/split-registry-store` was not present in this worktree and was not
  merged here.

## Operator handoff

Before using the offline preparation command, stop new ingress, wait for active
requests to finish, and stop the service. Fund the incoming address, run the
command with both keys supplied only through the process environment, update
the persistent current-key setting, remove the transient next-key setting, and
restart. The command deliberately refuses to claim durable activation.
