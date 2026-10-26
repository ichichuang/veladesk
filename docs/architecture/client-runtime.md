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
  bootstrap, remote discovery, persisted active-workspace preference,
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
2. **Multiple local copies** → open the remembered workspace when its id
   is still present; otherwise `selection-required` with local candidates
   in id ASC order. Bootstrap remains local-first: this branch does not
   wait for a remote catalog.
3. **No local copies** → remote catalog discovery: `0` → `empty`; `1` →
   pull + hydrate + `ready`; `>1` → `selection-required` in server order;
   a remembered id among several remote candidates is pulled directly;
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
session active. It also works from `ready`: registered UI guards finish
queued edits or return a readable refusal, then pending local stages and
in-flight saves are awaited and the current outbox is flushed. A conflict,
network failure or still-pending generation blocks the switch. Concurrent
management/selection calls receive `busy`. Late saves refresh state only
if their workspace is still active.

The last active id is stored under `veladesk:v1:last-workspace`; the bounded
recent-use order is stored under `veladesk:v1:recent-workspaces`. Access is
lazy, SSR-safe and best-effort (blocked/quota/corrupt storage cannot prevent
startup). Tests and non-browser hosts may inject `preferenceStorage`, or
pass `null` to disable it. No IndexedDB metadata table or schema bump.

`listWorkspaces` merges the remote catalog with local working copies,
preferring local names and ordering by recent use. `createWorkspace(snapshot)`
accepts a blank or preset snapshot assembled by the presentation layer;
`renameWorkspace(id, name)` and `deleteWorkspace(id)` use the same flush
boundary. These explicit management operations require a server response,
then hydrate/remove the local copy. Deleting the active workspace first
materializes a fallback and selects the most recently used survivor. The
existing offline `stageWorkspaceCreate` path remains unchanged.

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

## Production surface

The production homepage consumes this runtime through the generic
`WorkspaceRuntimeProvider`; its runtime states and surfaces are described
in [production-desktop-shell.md](./production-desktop-shell.md).

## Browser production transport (016-B)

In the browser, `getBrowserWorkspaceRuntime` composes the transport stack
MANUALLY: local store → HTTP workspace transport → asset-aware wrapper →
client runtime. The wrapper (`createAssetAwareWorkspaceSyncTransport`)
ensures every asset referenced by a snapshot is uploaded (or already
remote) BEFORE any workspace POST/PUT and maps asset failures onto the
shared transport failure contract — so the startup dirty sync is
asset-first too. The workspace sync COORDINATOR itself still knows
nothing about assets; package boundaries stay clean
(see [assets.md](./assets.md)).
