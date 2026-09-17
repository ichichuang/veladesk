# Database Persistence

## Purpose

`@veladesk/domain` defines the business aggregate: what a workspace is and
which invariants it satisfies (`validateWorkspace`). `@veladesk/database`
only owns durable persistence: how that aggregate is stored, versioned,
revised and concurrently saved in SQLite. The database layer never
re-validates domain shape beyond JSON syntax and the snapshot version —
rows are only written from already-validated snapshots.

## Storage model

V1 stores each workspace as a **current aggregate snapshot** plus
**append-only revision snapshots**:

- `workspaces` — one row per workspace: `id`, `name` (listing projection of
  `snapshot.name`), `revision`, `snapshot_version`, `snapshot_json`,
  `created_at`, `updated_at` (Unix epoch milliseconds).
- `workspace_revisions` — one row per saved revision: composite primary key
  `(workspace_id, revision)`, foreign key to `workspaces.id` with
  `ON DELETE CASCADE`.

Why snapshot storage instead of a normalized entity graph: personal
workspaces are small, an aggregate save is atomic by construction, backup is
a table dump, history is an append-only list, and optimistic revisioning
needs only one integer per row. This is a deliberate V1 trade-off, not the
database's final form.

## Revision model

- `createWorkspace` writes revision 1.
- Every successful `saveWorkspace` writes `actualRevision + 1`, even if the
  snapshot content is identical — a save is a persistence commit boundary;
  callers avoid redundant saves.
- Callers pass `expectedRevision`; when it differs from the stored revision
  the save returns `revision-conflict` with `actualRevision` instead of
  throwing. This is the server-side base for future multi-tab, offline sync
  and optimistic API updates.
- Revisions are per-workspace and strictly monotonic (1, 2, 3, …); there is
  no global auto-increment revision.
- Old revisions are immutable: later saves never change existing revision
  rows.

## Transactions

The current row and the revision row are written in **one transaction** on
both create and save. If either statement fails, neither changes: a
half-applied save (current row bumped without its history row) cannot occur.

## SQLite configuration

`openDatabase` applies `PRAGMA journal_mode = WAL`, `foreign_keys = ON`,
`busy_timeout = 5000` and `synchronous = NORMAL`. WAL is a local-disk
design: **the database must live on a local filesystem** — NFS/SMB/network
mounts are unsupported. `:memory:` databases (used by tests) report
`journal_mode = memory`, which is expected SQLite behavior.

## Migrations

Drizzle generates the SQL migrations (`pnpm --filter @veladesk/database
db:generate`) from the code-first schema; the `drizzle/` folder and its
`meta/` journal are version controlled, and `applyMigrations(database,
migrationsFolder)` applies them via the Drizzle migrator. The folder is an
explicit argument because how migration SQL ships with a deployment is a
deliberate packaging decision for later tasks. `drizzle-kit push` is a
development convenience and is never the production migration path.

## Snapshot versioning

`WORKSPACE_SNAPSHOT_VERSION` (currently 1) versions the persisted JSON
structure and is independent from the package version (0.1.0). Every row —
current and revision — stores the version it was written with; decoding a
row with a different version throws, so a future Domain JSON change can be
migrated explicitly instead of corrupting silently.

## Future normalization

If product queries later require it, normalized projection tables (per
entity kind, categories, dock pins) may be added without changing the
Workspace Domain aggregate contract: `WorkspaceSnapshot` remains the
authoritative aggregate for validation, import/export, backup/restore and
the UI mental model.
