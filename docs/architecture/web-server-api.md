# Web Server API

## Responsibility

The server layer wires the completed `@veladesk/domain` and
`@veladesk/database` packages into the Next.js Node server runtime and
exposes them as the workspace HTTP API v1. Each layer owns exactly one
concern:

| Layer | Owns | Does not own |
| --- | --- | --- |
| `app/api/v1/**/route.ts` | Next.js adapter: await params, get repository, delegate, return | Business logic, decoding |
| `server/api/` | Request decoding, structural validation, status mapping, response envelopes | SQL, domain invariants |
| `@veladesk/database` repository | Persistence semantics: transactions, revisions, compare-and-swap | HTTP concepts |
| `@veladesk/domain` | Business invariants (`validateWorkspace`) | Storage, transport |

Route files are deliberately thin — everything testable lives in
`server/` and runs under plain Node Vitest with standard
`Request`/`Response` objects, no Next-specific APIs.

## Runtime

Node.js only (`export const runtime = "nodejs"` in every database-backed
route): persistence is better-sqlite3 (native), which cannot run on Edge.
The database runtime is a lazy per-process singleton stored on
`globalThis`:

- one SQLite connection per process, reused across requests;
- dev HMR module reloads do not open new connections;
- migrations run at most once per process;
- importing route modules (as `next build` does) never touches the
  filesystem — no `mkdir`, no database open, no config resolution — so
  builds succeed without any `VELADESK_*` environment.

A failed initialization closes the database before rethrowing; a
half-initialized runtime is never returned or cached.

## Configuration

Two runtime environment variables only:

| Variable | Meaning |
| --- | --- |
| `VELADESK_DATA_DIR` | Directory holding `veladesk.db` (plus WAL sidecars) |
| `VELADESK_MIGRATIONS_DIR` | Drizzle migration folder (`packages/database/drizzle`) |

- Development/test defaults: data lands in `<apps/web cwd>/.veladesk-data`,
  migrations are read from the monorepo's `packages/database/drizzle`.
- Production (`NODE_ENV=production`): both variables are required
  explicitly — a server must never create its database relative to an
  arbitrary launch directory. Missing variables fail startup with an error
  naming the variable.
- A variable that is set but blank is rejected (not treated as unset).
- Relative env paths resolve against the process cwd; values are never
  trimmed.

## Migration lifecycle

On the first server runtime access in a process: open SQLite (WAL, foreign
keys, busy timeout), apply the committed Drizzle migrations from the
configured folder, then build the workspace repository. Migration failure
closes the database and propagates. Task 006 adds no schema migrations;
`pnpm --filter @veladesk/database db:generate` must report no drift.

## HTTP API v1

All endpoints are same-origin, JSON, `Cache-Control: no-store`.

| Method | Resource | Handler |
| --- | --- | --- |
| GET | `/api/v1/workspaces` | list workspace summaries |
| POST | `/api/v1/workspaces` | create workspace (body `{ snapshot }`) |
| GET | `/api/v1/workspaces/:workspaceId` | load current stored workspace |
| PUT | `/api/v1/workspaces/:workspaceId` | optimistic save (body `{ snapshot, expectedRevision }`) |
| GET | `/api/v1/workspaces/:workspaceId/revisions` | list revision summaries |
| GET | `/api/v1/workspaces/:workspaceId/revisions/:revision` | load one revision |

Success responses: `{ workspaces }`, `{ workspace }` (201 on create, with
a `Location` header carrying the percent-encoded id), `{ revisions }`,
`{ revision }`. There is deliberately no DELETE/PATCH yet (no delete
workspace / restore revision in this stage).

## Error semantics

Expected business and request failures return a JSON envelope
`{ "error": { "code": ..., ...} }`, never an HTML error body:

| Status | Code | Notes |
| --- | --- | --- |
| 400 | `invalid-json` | body is not parseable JSON |
| 400 | `invalid-request` | JSON shape fails structural decoding |
| 400 | `workspace-id-mismatch` | route id ≠ `snapshot.id` (PUT) |
| 400 | `invalid-revision` | non-canonical revision segment or bad `expectedRevision` |
| 404 | `workspace-not-found` | unknown workspace (including revision routes) |
| 404 | `revision-not-found` | known workspace, unknown revision |
| 409 | `workspace-already-exists` | create on an existing id |
| 409 | `revision-conflict` | lost optimistic race; carries `actualRevision` |
| 422 | `invalid-workspace` | domain validation failed; carries `issues` |

Malformed JSON is scoped to the body read only: repository, SQLite and I/O
failures are never relabeled as `invalid-json` — they propagate as real
500s.

## Structural decoding

`server/api/input.ts` verifies that untrusted JSON *has* the
`WorkspaceSnapshot` structure (records, arrays, strings, the app/folder/
widget kind discriminant, icon union, JSON-object widget config, …) before
the value reaches the domain. It never re-implements semantic rules — blank
names, bounds, overlaps and references stay in `validateWorkspace` +
`@veladesk/desktop-engine`. Unknown extra properties are ignored; nothing
is auto-trimmed.

## Optimistic concurrency

PUT carries `expectedRevision`; the repository performs a database-level
compare-and-swap (`UPDATE ... WHERE id = ? AND revision = ?`). The API
layer does not re-implement concurrency — it only maps `revision-conflict`
(with the repository-reported `actualRevision`) to 409.

## Caching

Every response — success or error — carries `Cache-Control: no-store`.
GET route handlers are dynamic; no `force-dynamic` overrides are used.

## Standalone packaging

`next.config.ts` sets `outputFileTracingRoot` to the monorepo root and
includes `packages/database/drizzle/**/*` for `/api/v1/**` routes, so the
migration SQL + `meta/_journal.json` ship inside `.next/standalone`
(Next's automatic tracing cannot see the dynamically-read migrations
folder). better-sqlite3 is auto-externalized by Next with its native
prebuild traced in. `pnpm --filter @veladesk/web smoke:standalone` boots
the production server twice against a temp data dir and proves: migration
assets present, native module loading, API working, and data persisting
across a restart. The same check runs in CI after Build.

## Security/auth scope

The current stage is trusted-LAN / same-origin: no authentication, no CORS.
This is a deployment-stage statement, not a final product promise — auth
(none / password / accounts modes) is a later, separate task.
