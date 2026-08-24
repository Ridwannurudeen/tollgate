# Scope: FeeRouter split registry store

The split identity was already correct: Tollgate keys a split by tenant, creator
wallet, ordered recipients, and ordered basis points. The missing boundary was
the write. A whole-registry `read()` followed by an on-chain `createSplit` and a
whole-registry `write()` lets two writers both spend gas, then lets the last JSON
write erase the other record.

This change makes that boundary explicit in the SDK. `SplitRegistryStore` keeps
its existing `read()` and `write()` methods and adds an optional atomic
`getOrInsert()` operation. `ensureCreatorSplit` uses the atomic operation when a
store provides it and keeps the current process-local read/write fallback for
existing two-method stores.

## The operation

`getOrInsert()` receives the complete split identity and a callback that creates
the on-chain split record. A store must claim that identity durably before it
invokes the callback. Once claimed, another writer must return the committed
record or report that creation is still pending; it must not invoke the callback
again.

That ordering is deliberate. A blockchain transaction and a registry write
cannot be one database transaction. If the process stops after broadcasting
`createSplit` but before recording its result, automatically retrying can create
a second real split and spend gas twice. A pending claim therefore survives an
ambiguous failure. Recovery is explicit: inspect the chain from the claim time,
record the matching split if one exists, or clear the claim only after proving
that no transaction was submitted. Availability is sacrificed rather than
silently violating at-most-once creation.

The guarantee depends on every writer using `getOrInsert()`. The backward-
compatible read/write fallback remains process-local and cannot coordinate with
an older process that still performs its own read-modify-write cycle.

## What the file store builds

The Node file store implements the new operation with sibling metadata:

- one exclusive pending file per normalized split identity, created before the
  on-chain callback;
- one short-lived exclusive write lock while the latest registry is reread and
  the completed record is appended;
- the existing temporary-file-and-rename write for the registry itself.

`fee-router-splits.json` does not change. Existing files load without migration,
and new writes remain the same `{ "splits": [...] }` JSON accepted by
`parseFeeRouterSplitRegistry`. Pending claims and the write lock are separate
sibling paths.

On a local filesystem this prevents two cooperating processes on one host from
creating the same tuple and prevents concurrent inserts for different tuples
from losing a row. A process that dies after claiming a tuple leaves it blocked
for manual reconciliation. A process that dies while holding the short registry
write lock can also leave later appends blocked until an operator verifies and
removes that lock. These failure modes are visible and conservative; neither
silently retries an ambiguous on-chain write.

The file store is not a distributed database. It does not claim cross-host
correctness on independent disks, and network-filesystem exclusive-create
semantics are outside this guarantee. It also cannot make a blockchain
transaction atomic with local storage.

## What is deliberately not built

This branch does not add SQLite, Postgres, a lock service, automatic stale-claim
cleanup, or chain-event reconciliation. Automatic cleanup would weaken the
at-most-once rule because elapsed time cannot prove that a transaction was never
broadcast.

A production multi-host backend should store a normalized identity under a
unique constraint, commit a durable `pending` row before calling the chain, and
transition that row to `created` with the split id and transaction hash. It can
let concurrent callers wait for and reuse the created row, expose pending work
for reconciliation, and serialize inserts across hosts. The unique constraint
alone is not enough: deleting or rolling back the pending row after an ambiguous
chain error recreates the duplicate-transaction window.

The seam is built here; a database backend is not. The file store is the
zero-migration default for the current single host, while `getOrInsert()` is the
contract an external integrator can implement against storage with stronger
coordination and recovery guarantees.
