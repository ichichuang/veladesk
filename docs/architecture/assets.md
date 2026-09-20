# Asset Pipeline

## Identity

Every uploaded asset is content-addressed: the id is

```
asset-sha256-<64 lowercase hex>
```

— the lowercase hex SHA-256 of the EXACT uploaded bytes, computed with the
standard Web Crypto API (`crypto.subtle.digest("SHA-256", …)`), which runs
identically in Node 24 and the browser. No filename, timestamp or UUID ever
enters the identity. Consequences:

- equal bytes ⇒ equal id (natural dedupe across apps, pages, workspaces);
- a PUT of the same bytes is idempotent (201 stored / 200 already existed);
- the id doubles as the integrity check — every read path re-hashes and
  rejects bytes that do not hash back to their id (`verifyAssetBytes`).

## Supported image types

V1 accepts exactly four formats, detected purely by MAGIC BYTES — never by
filename, extension or `Content-Type` header:

| Media type | Detection |
| --- | --- |
| `image/png` | the standard 8-byte PNG signature |
| `image/jpeg` | `FF D8 FF` |
| `image/webp` | `RIFF` at 0, `WEBP` at 8 |
| `image/avif` | ISO-BMFF `ftyp` box with brand `avif` or `avis` |

SVG uploads are deliberately excluded (an SVG is an arbitrary execution /
external-reference surface), as are GIF (no animation icons in v1), BMP and
ICO. The shared size budget is `MAX_ASSET_BYTES = 4 MiB` — one constant used
verbatim by the browser stage path and the server PUT boundary. Zero-byte
uploads are rejected, as is anything larger.

All of this lives in `@veladesk/assets/core` (pure, dependency-free, identical
in Node and browser). The server imports ONLY `./core`; the browser adds
`./browser` (Dexie store, HTTP transport, runtime).

## Browser store

Uploaded assets live in their OWN IndexedDB database (`veladesk-assets` in
production, `<workspace-db>-assets` for labs via
`assetDatabaseNameForWorkspaceDatabase`) — the existing `veladesk-local`
workspace store schema is never touched. Schema v1:

```
assets:      "&id, syncState, createdAt"
assetOutbox: "&assetId, queuedAt"
```

`LocalAssetRecord` = `{ id, blob, mediaType, byteLength, createdAt, syncState:
"pending" | "clean" }`. The blob is stored as a Blob, never as base64 —
`WorkspaceSnapshot` only ever carries the `assetId` (an asset icon is
`{ kind: "asset", assetId }`), so workspace revisions never copy image bytes.

## Outbox

The `assetOutbox` holds at most one entry per asset. `stageAsset` inserts the
record as `pending` and appends the outbox entry in ONE Dexie transaction;
re-staging an already-pending asset preserves both the stored blob and the
original `queuedAt`; staging an already-`clean` asset is a no-op (the server
already ACKed that exact content). `listAssetOutbox` is deterministic:
`queuedAt` ASC, then `assetId` ASC. A successful upload ACK marks the record
`clean` and deletes the entry; acking an unknown asset is an invariant failure,
never a silent create. `hydrateRemoteAsset` (remote bytes arriving) re-detects
and re-hashes before storing `clean` — a hash mismatch is a protocol failure,
never data.

## Server persistence

`apps/web/server/assets/repository.ts` stores one immutable file per asset:

```
VELADESK_DATA_DIR/
  veladesk.db …
  assets/
    asset-sha256-….bin
```

No SQLite table, no metadata sidecar — the bytes ARE the metadata (the media
type is re-detected from magic on every read). Writes are atomic: temp file in
the same directory, then rename after the complete write; a failure cleans the
temp file and never leaves a partial final file. A duplicate PUT verifies the
existing file's hash against its id and reports success WITHOUT rewriting
(hash mismatch ⇒ `corrupt-existing`, never success). A filename is only ever
built from an id that passed `isContentAssetId`, so `/`, `\`, `..`, `%` and
whitespace can never reach the filesystem layer.

## API

`/api/v1/assets/:assetId` (no auth change — same trusted-LAN model):

| Method | Contract |
| --- | --- |
| PUT | raw binary body (never multipart), read through a BOUNDED stream reader — over-budget bodies are cut off and answered `413 asset-too-large` before hashing. Pipeline: validate id (400 `invalid-asset-id`) → bounded read → magic detect (415 `unsupported-image-type`) → SHA-256 → id equality (422 `asset-id-mismatch`) → store. Responses: `{ asset: { id, mediaType, byteLength } }`, 201 new / 200 existed. |
| GET | 200 raw bytes with `Content-Type` (detected), `Content-Length`, `Cache-Control: public, max-age=31536000, immutable`, `ETag: "<assetId>"`; 404 `asset-not-found`. |
| HEAD | Same metadata headers, no body — used by sync to probe remote existence. |

## Local-first

The browser runtime (`createAssetRuntime`) reads local first: a store hit
returns the Blob with ZERO network. A miss does one hash-verified GET and
hydrates the local record `clean`. Uploads stage locally (`pending`) before
anything is written to the workspace; sync is explicit. Same-process
singleflight: concurrent `syncAsset` calls share ONE PUT, concurrent
`loadAsset` misses share ONE GET. `flushOutbox` is a one-pass flush over the
snapshot taken at flush start; failures (network / 5xx / protocol) leave the
record pending and the outbox intact.

The web layer adds decode verification before a file may enter a draft:
`createImageBitmap` must succeed and dimensions stay within 1–4096 per side
(web-UI policy; the server contract never decodes).

## Asset-before-workspace sync

The browser production workspace transport is wrapped by
`createAssetAwareWorkspaceSyncTransport`: `listWorkspaces` / `getWorkspace`
delegate untouched; `createWorkspace` / `saveWorkspace` FIRST ensure every
asset id referenced by the snapshot is remote-ready
(`ensureRemoteAsset`: pending → PUT, clean → nothing, missing → HEAD probe),
and only then call the base transport. Failure mapping: asset network-error →
workspace `network-error`; 5xx → `server-error`; missing / hash / protocol →
`protocol-error`. The hard rule: **an asset failure never lets a workspace
POST/PUT through** — a snapshot is never committed ahead of its bytes. A
snapshot without asset references never even resolves the asset runtime (no
asset IndexedDB open). The sync coordinator itself stays asset-blind.

## Rendering

`AppIconRenderer` renders `kind: "asset"` through `useAssetImageUrl`:
local-first blob → `URL.createObjectURL` → a plain `<img>` (alt="",
aria-hidden, draggable=false, `object-fit: contain`) inside the decoration
tile. Decoration styles (gradient/solid/glass/none) still paint the tile;
`iconScale` still scales it; `foregroundColor` is IGNORED for uploaded images
(they keep their own colors). Remote hydration and any failure degrade to the
generated text initials — never a broken image. Preview URLs are revoked on
change/unmount.

## Backups

The complete backup boundary is the whole `VELADESK_DATA_DIR` — SQLite file
AND the `assets/` directory together. Backing up only the SQLite file is NOT
sufficient from 016-B on: an asset referenced by a stored snapshot would be
lost. (No backup command changes in this task; documented contract only.)

## Garbage collection

Not implemented. Deleting an asset binary when an app replaces its icon is
forbidden — historical workspace revisions may still reference the old asset.
Orphan cleanup (local records and server files) must be designed against a
revisions/reference scan in a separate future task.
