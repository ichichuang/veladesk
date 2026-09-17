# Workspace Sync

## Responsibility

Four layers cooperate to persist a workspace, and each owns exactly one
concern:

- **`@veladesk/local-store`** — the browser working copy and the outbox
  state machine. It owns `serverRevision`, `localGeneration`, `syncState`
  (`clean` / `dirty` / `conflict`) and the coalesced one-entry-per-workspace
  outbox. It never performs network I/O.
- **`@veladesk/sync`** — the network transport and the orchestration that
  drives the outbox over it. Browser-safe only: `fetch`, `Request`,
  `Response`, `@veladesk/domain` and `@veladesk/local-store`. No SQLite, no
  Node APIs, no React.
- **Web server API** — the HTTP persistence boundary. It decodes request
  bodies with the shared domain decoder, maps repository results to status
  codes (`201`, `404` + `workspace-not-found`, `409` +
  `workspace-already-exists` / `revision-conflict` + `actualRevision`,
  `422` + `invalid-workspace`) and owns the response envelopes
  (`{ workspace: … }`, `{ error: { code, … } }`).
- **`@veladesk/database`** — the server source of record: canonical
  snapshots, compare-and-save revision checks and the append-only revision
  history.

## Explicit synchronization

In this stage every sync operation is an explicit call:

- `syncWorkspace(id)` — send the pending mutation of one workspace.
- `flushOutbox()` — send the pending mutation of every workspace.
- `pullWorkspace(id)` — refresh one workspace from the server.

There is no timer, no retry loop, no backoff, no `BroadcastChannel`, no
WebSocket, no service worker. Retry scheduling is a later task; until then
a failed sync simply keeps its outbox entry and waits for the next explicit
call.

## Single-flight

Within one process (one coordinator instance), concurrent `syncWorkspace`
calls for the **same** workspace share a single in-flight request — an
in-flight promise map guarantees at most one mutation request per
workspace. Different workspaces never serialize against each other, and
there is deliberately no global lock.

This is **not** a multi-tab lock: two browser tabs each run their own
coordinator. Cross-tab safety comes from the server's compare-and-save
revision check plus the local generation guards — data can never be
silently overwritten, only surfaced as a conflict.

## Outbox generation

A request captures the outbox entry once — operation, base revision,
snapshot and the local generation at send time. IndexedDB may keep changing
while the request is in flight. When the response arrives, the local-store
acknowledgement compares the captured generation with the current one:

- equal → the server snapshot becomes the accepted truth, the entry is
  cleared, the workspace is `clean`;
- older (the user kept editing) → the newer local snapshot is preserved,
  `serverRevision` advances, and the outbox entry is rebased as a `save` on
  the new revision — the workspace stays `pending` for the next explicit
  sync.

A sync request therefore reports `synced` or `pending`, never silently
overwrites newer local work.

## Ambiguous success recovery

The network is at-least-once: a request may succeed on the server while its
response is lost. The retry then hits `409` — and a naive client would
fabricate a conflict out of its own earlier success. The coordinator
therefore never maps a `409` to a conflict directly; it first reads the
remote current state with `GET /api/v1/workspaces/:id`:

- **remote snapshot deep-equals the sent snapshot** → the earlier request
  succeeded. The coordinator acknowledges it with the *current* remote
  revision (after a lost create response this is the created revision; a
  lost save response may legitimately resolve to a newer revision if the
  server moved on without changing the business state).
- **different** → a genuine conflict, marked with the revision the GET
  observed (for a save conflict this may be newer than the revision in the
  original 409 body).

Failure handling of the recovery GET itself:

- **save conflict:** the 409 body's `actualRevision` is hard knowledge that
  must not be lost — the conflict is marked with it even when the GET fails
  (network, server, protocol, or even `not-found`).
- **create conflict:** a `409 workspace-already-exists` carries no revision,
  so nothing can be marked safely. The dirty create outbox is preserved and
  the GET failure is surfaced (`not-found` maps to `server-missing`: the
  server contradicting itself must not become a guessed conflict revision).

## Snapshot equality

The equality used for recovery is structural and recursive:

- arrays are **order-sensitive** — page order, dock order, tag order and
  layout items are business semantics;
- object property insertion order is **insignificant** — a widget config
  `{ a: 1, b: 2 }` equals `{ b: 2, a: 1 }` because JSON key order carries no
  meaning after a round-trip.

`JSON.stringify` comparison is deliberately avoided for exactly that
reason. The helper is package-internal; no deep-equal dependency.

## Conflict

Sync only **marks** conflicts (`syncState: "conflict"` +
`conflictRevision`), keeping the local snapshot and the outbox untouched
for later resolution. It never merges, never picks a winner, and performs
no CRDT gymnastics — conflict resolution UX is a separate future task.

## Failure policy

`network-error`, `server-error` and `protocol-error` results always leave
the outbox entry (and the workspace record) untouched, so nothing is lost
offline or during an outage. The same holds for `server-rejected` (422:
validation drift between client and server versions) and `server-missing`
(404 on save: automatically re-creating a deleted server workspace is a
dangerous policy that v1 refuses to guess at).

Task 008 contains no automatic retry: no timers, no backoff, no scheduler.
Recovery from a failed sync is the next explicit `syncWorkspace` /
`flushOutbox` call.

## Pull

`pullWorkspace` protects unsynchronized local work: a local copy in
`dirty` or `conflict` state is never overwritten and no network request is
even made. A missing or `clean` local copy is refreshed through
`hydrateWorkspaceFromServer`, which accepts equal-or-newer revisions and
refuses stale ones (`stale-server-revision`).

## Flushing

`flushOutbox` lists the outbox once (deterministic `queuedAt` then
`workspaceId` order) and syncs each workspace **at most once per flush**.
Work re-queued by in-flight local edits during the flush stays `pending`
until the next explicit flush — a user who keeps editing must not be able
to keep a single flush alive forever. One workspace's failure never stops
the others; only a genuine invariant violation (local-store corruption)
rejects the flush.
