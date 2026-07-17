# Aperture security boundary

Do not restore the original access-log settlement design from an older clone.
The audited tree may be ahead of `/opt/aperture`; no deployment is implied by
repository changes.

## Settlement invariant

1. `src/lib/license-download.ts` is the sole Immich payment and receipt writer.
2. `src/lib/license-check.ts` accepts only a short-lived, one-use authorization
   bound to the shared-link key and archive POST.
3. `src/lib/watcher.ts` is observation-only. It reads successful access-log
   events and existing receipts; it never calls FeeRouter or appends a receipt.
4. Both nginx archive entry points retain their exact `auth_request` locations.

Before any approved deployment, run the full security regression suite and
confirm the watcher has no FeeRouter or ledger-append import.

## Source of truth

Production lives at `/opt/aperture`. Verify its commit and configuration before
any approved deployment; never assume it already mirrors this tree.
