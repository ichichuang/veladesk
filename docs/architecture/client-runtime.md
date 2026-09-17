# Client Runtime

## Responsibility

Five layers cooperate to put a workspace on screen, and each owns exactly
one concern:

- **`@veladesk/domain`** — pure business contracts (snapshots, validation).
- **`@veladesk/local-store`** — the durable browser working copy, outbox
  and sync-state machine over IndexedDB. No network.
- **`@veladesk/sync`** — the HTTP transport and outbox coordination. No UI,
  no storage of its own.
- **`@veladesk/client-runtime`** — the workspace session: local-first
  bootstrap, remote discovery, in-memory active-workspace selection,
  startup reconciliation and explicit sync/pull orchestration, exposed as
  an external store. No React, no Next.js, no Node APIs — a PWA or New Tab
  extension can reuse it verbatim.
- **React (apps/web adapter)** — presentation only: a provider that
  bridges the runtime external store via `useSyncExternalStore`, plus the
  `/lab/workspace-runtime` engineering lab. Domain/session state never
  moves into React.

## Bootstrap

`initialize()` is single-flight per runtime and strictly local-first:

1. **Exactly one local copy** → the runtime is `ready` immediately with
   that workspace, and one startup reconciliation runs in the background.
2. **Multiple local copies** → `selection-required` with local candidates
   in id ASC order. The remote catalog is not even consulted: v1 has no
   persisted active-workspace id, so the runtime refuses to guess which
   workspace the user means.
3. **No local copies** → remote catalog discovery: `0` → `empty`; `1` →
   pull + hydrate + `ready`; `>1` → `selection-required` in server order;
   list failure → `remote-unavailable` (network-error / server-error +
   httpStatus / protocol-error ± httpStatus).

If the single remote pull fails but the workspace exists locally anyway
(another tab hydrated it in between), the local record wins and the state
is `ready` with the pull outcome as `lastRemoteResult` — never a
manufactured error state.

## Startup reconciliation

One reconcile per opened workspace, driven by its sync state:

- `clean` → `pullWorkspace` (accepts equal-or-newer remote revisions).
- `dirty` → `syncWorkspace` (any outcome — synced, pending, conflict,
  server-missing, failures — is recorded and the latest IndexedDB record is
  re-read into state).
- `conflict` → **no network at all**; the result is `conflict-present`.
  An unresolved conflict must never be re-sent automatically.

Whatever the reconcile outcome, the runtime state is refreshed from the
latest store record — the bootstrap-time object is stale the moment
anything changed.

## Offline behavior

With a local workspace open, every network failure (network-error,
server-error, protocol-error, server-missing) degrades to
`lastRemoteResult`; the runtime stays `ready` and the local desktop stays
usable. Only a genuinely empty local store can produce
`remote-unavailable`. Local IndexedDB failures reject instead — real
storage corruption is never disguised as a remote problem.

## Selection

`selectWorkspace` opens an existing local copy (and reconciles it) or
pulls a remote-only one into the local store; failures keep the previous
selection state untouched. The active workspace lives **only in runtime
memory** in v1: no IndexedDB metadata table, no `LOCAL_STORE_SCHEMA_VERSION`
bump, no localStorage. With several local copies every start requires
selection again — persisting the choice needs a user-preference model that
is deliberately out of scope.

## Editing

`stageWorkspaceCreate` makes a new local workspace the active session
instantly — no network, no generated ids, no implicit default workspace.
`stageWorkspaceUpdate` only accepts snapshots of the **current** workspace
(`no-active-workspace` / `workspace-id-mismatch` guards) and never sends.
Drag-and-drop and edits only touch the local working copy; the network is
an explicit decision.

## Explicit sync

`syncCurrent` (refuses to re-send an unresolved conflict:
`conflict-present`) and `pullCurrent` delegate to the sync coordinator and
then re-read the latest local record into state. There is no timer, no
retry scheduler, no background loop anywhere in the stack.

## External store

The runtime is a plain external store: `getSnapshot()` returns the current
state reference (state is replaced whole, never mutated) and
`subscribe(listener)` fires only on replacement, returning an unsubscribe
function. This is exactly the `useSyncExternalStore` contract — React code
needs no state library.

## close

`close()` closes the underlying store and detaches listeners; later
mutations and `initialize()` throw
(`"workspace client runtime is closed"`) instead of silently reopening.

## Browser reuse

`@veladesk/client-runtime` imports only `@veladesk/domain`,
`@veladesk/local-store`, `@veladesk/sync` and standard web platform types.
`openWorkspaceClientRuntime` is the convenience constructor for browsers;
tests inject `indexedDB`/`IDBKeyRange`/`fetch`. React code in apps/web
creates the singleton lazily inside a client effect, so server-side
rendering never touches IndexedDB or fetch.
