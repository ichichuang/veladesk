# Local-First Store

## Purpose

`@veladesk/local-store` owns the browser-side durable state of a workspace.
The SQLite database behind `@veladesk/database` is the durable **server**
source-of-record: it holds the canonical snapshots and the append-only
revision history. IndexedDB is only the **browser working copy plus pending
outbox** — a local-first cache that makes the start page usable offline and
keeps local edits durably queued until the server accepts them. It is not a
second authoritative server DB, and it never invents server state.

The package deliberately has no network layer, no React, and no scheduler.
It only maintains the working-copy state machine; a later sync coordinator
task will read the outbox, perform HTTP create/save calls, and feed the
acknowledgement / conflict results back in.

## Record model

Each workspace has one `LocalWorkspaceRecord`:

- `serverRevision` — last server revision this client knows to be committed.
  `null` means the workspace has never successfully existed on the server
  yet (offline-created).
- `localGeneration` — monotonic counter of local edits. Server hydration
  starts at 0; every local create/update increments it. It lets the sync
  layer detect "the user kept editing while a request was in flight".
- `syncState` — `clean` (matches the server), `dirty` (local edits are
  pending in the outbox), or `conflict` (the server rejected a save with a
  revision mismatch and the conflict is unresolved).
- `lastSyncedAt` — local timestamp when a server state was last accepted;
  `null` for a never-synced workspace. `updatedAt` is the timestamp of the
  latest working-copy change.

Invariants maintained by code and tests: `clean` has no outbox entry and no
`conflictRevision`; `dirty` and `conflict` each have exactly one outbox
entry; `conflict` always carries a `conflictRevision`.

## Outbox coalescing

A workspace has **at most one** pending outbox entry — not one per edit.
Every local update overwrites the pending entry's snapshot and generation,
while preserving the original `queuedAt` (when the workspace first became
pending). Dragging an icon 100 times therefore produces one IndexedDB
rewrite per edit and, eventually, **one** network write, not 100 queued
requests. The outbox entry records whether the pending mutation is a
`create` (`baseRevision` null, local `serverRevision` null) or a `save`
(`baseRevision` = the server revision the mutation is based on). There is
deliberately no outbox history — server-side revision history already lives
in SQLite.

## Offline create

`stageWorkspaceCreate` writes a record with `serverRevision` null,
`localGeneration` 1, syncState `dirty`, and a `create` outbox entry. Further
local edits keep coalescing into that same `create` entry until the server
has actually accepted the workspace for the first time.

## In-flight edits

`acknowledgeWorkspaceSync` carries the local generation that was actually
sent. If the user edited again after the request left (current generation
is higher), the acknowledgement never overwrites the newer local snapshot:
it only records the new `serverRevision`/`lastSyncedAt`, keeps the working
copy `dirty`, and rewrites the pending outbox onto the new base revision.
A create request that succeeds while the user keeps editing therefore turns
the pending `create` into a `save` expecting the freshly assigned revision —
no local edit is ever lost. Responses from the past are refused: a higher
input generation than the record's is `stale-generation`, and a server
revision that would move backwards (below the committed revision or a known
conflict revision) is `stale-server-revision`.

## Conflict

A 409 revision-conflict response is only *marked*: `markWorkspaceConflict`
sets `syncState` conflict and `conflictRevision` = the server's actual
revision, and leaves `serverRevision`, the local snapshot and the outbox
untouched. The local copy is never silently overwritten, and it never
pretends to be synced. Pulling the remote snapshot, merging, or resolving
the conflict belongs to the later sync coordinator.

## Transactions

Every operation that touches both the working copy and the outbox (stage
create, stage update, acknowledgement, conflict marking, server hydration)
runs in a single Dexie transaction, so the two tables can never disagree —
there is no intermediate state where a record is `dirty` without its outbox
entry. Transaction callbacks contain only Dexie calls and synchronous pure
calculations.

## IndexedDB schema version

`LOCAL_STORE_SCHEMA_VERSION` (currently 1) versions the IndexedDB object
stores only. It is deliberately independent of the workspace snapshot JSON
version, the app version, and the server revision — the three must never be
conflated. Schema migrations of the local stores will bump this constant
alone.

## Scope

This task intentionally contains **no** network access, React, TanStack
Query, Zustand, automatic retry, or multi-tab messaging (BroadcastChannel /
WebSocket / SSE / service worker). Those belong to future tasks, as does
Dexie Cloud / `dexie-syncable` (not used). The package depends only on
`@veladesk/domain`, Dexie and the browser IndexedDB contract, so the same
store can later serve the PWA and a New Tab extension.
