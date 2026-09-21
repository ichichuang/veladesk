# Workspace Domain

## Purpose

Task 004 introduces `@veladesk/domain`, the business domain contract of a
VelaDesk workspace. It describes workspaces, desktop pages, app shortcuts,
folders, widget instances, categories, the dock, preferences and icon
references — everything the future persistence layer, API, IndexedDB cache,
React UI, import/export, plugin runtime and backup/restore will share.

The boundary with its neighbours:

| Package | Owns | Does not own |
| --- | --- | --- |
| `@veladesk/domain` | Business entities, identity, containment, references, business-level validation | Geometry, pixels, gestures, storage |
| `@veladesk/desktop-engine` | Legacy grid geometry: grid, positions, spans, overlap, bounds, grid layout history | App metadata, folders, widgets, URLs, categories |
| `@veladesk/canvas-engine` | Versioned placement: logical units, integer Grid cell geometry, rects, conversion lattice, translation/resize math, canvas history | Domain entities, persistence, rendering |
| `@veladesk/desktop-interaction` | Pixel-to-grid drag mapping (lab path) | Domain model |
| database / API / UI (future) | Normalization, persistence, rendering | Domain invariants |

The domain is pure TypeScript: no React, no DOM, no dnd-kit, no runtime
dependency besides `@veladesk/desktop-engine` and `@veladesk/canvas-engine`.
Its engine dependencies are the `PageLayout` / `CanvasLayout` type families
plus the validation (`validatePageLayout`, `validateCanvasLayout`) and
`createGridDefinition` delegation described below.

## Aggregate model

`WorkspaceSnapshot` is the serializable business snapshot of one whole
workspace:

- `id`, `name`
- `pages: DesktopPage[]` — ordered desktop pages
- `entities: WorkspaceEntity[]` — every app, folder and widget
- `categories: Category[]` — ordered app categories
- `dock: Dock` — pinned entity references
- `preferences: WorkspacePreferences` — `defaultPageId`, `layoutLocked`

Collections are arrays, not records, on purpose: JSON-direct serialization,
deterministic ordering, inherently ordered collections (pages, categories,
dock pins, folder children), and small early-stage workspaces.

### WorkspacePreferences appearance

Since Task 014, `WorkspacePreferences` carries an optional
`appearance: WorkspaceAppearancePreferences` (color mode, accent hue,
wallpaper preset, surface opacity, blur, radius, icon size). It is optional
for backward compatibility: snapshots persisted before the field existed
remain valid forever — the decoder accepts its absence, validation runs
only when it is present, and readers resolve it to
`DEFAULT_WORKSPACE_APPEARANCE` without writing a migration. The stored
"upgrade" of a legacy snapshot happens only when the user saves Settings
(`replaceWorkspacePreferences`, see
[appearance-settings.md](./appearance-settings.md)).

### AppShortcut visual style and icon source

Since Task 016-A, an app shortcut carries two more optional fields, both
following the same no-migration compatibility rule:

- `visual?: AppVisualStyle` — `iconScale` (finite 0.5–2.0),
  `decorationStyle` (`gradient | solid | glass | none`) and optional
  exact-`#RRGGBB` `foregroundColor` / `decorationColor`. An absent
  `visual` resolves to `DEFAULT_APP_VISUAL_STYLE` at render time;
  `validateWorkspace` reports `invalid-app-visual` issues only for a
  persisted style, delegating the ranges to `validateAppVisualStyle`
  (never duplicated in `validation.ts`). `iconScale` is a visual
  multiplier only — it scales the glyph inside the tile and never the tile's
  rect, so canvas geometry (016-C) is unaffected by it
  (the range widened from 0.5–1.6 in Task 016-C, which kept every
  existing snapshot legal).
  See [app-visual-system.md](./app-visual-system.md).
- `icon.source` on `generated` icons — `"auto"` (or the legacy
  `undefined`) initials follow renames; `"custom"` text is user-owned
  and renames never overwrite it.

## Entity identity

`EntityId` is globally unique across all entity kinds within one workspace:
an app `"foo"` and a folder `"foo"` still collide. There is no per-kind
namespace.

**Identifier invariant:** all identifier strings — workspace id, page id,
entity id, category id — must be non-blank (`id.trim().length > 0`).
`validateWorkspace` reports blank ids as `invalid-workspace-id`,
`invalid-page-id`, `invalid-entity-id` or `invalid-category-id` and keeps
discovering independent issues. Ids are never trimmed: values with
surrounding whitespace (e.g. `" workspace "`) are valid and stored verbatim.

Reason: desktop-engine `LayoutItem.id` references domain entities directly,
so a page layout never needs a second mapping table between layout items and
business entities. One id, one meaning, everywhere. (Identity aliases are
plain `string` for now — no nominal branding, to avoid premature serialization
friction before the database/API exist.)

## Containers

Pages and folders are **exclusive containers**: an entity may be

1. a layout item on exactly one page, or
2. (apps only) a child of exactly one folder, or
3. unplaced — existing only in the App Library.

It may never combine two of those: not two pages, not page + folder, not two
folders. Folders and widgets cannot be folder children in V1.

The **dock is orthogonal**: it is a pin/reference list, not a container.
An app may live on a page and be docked simultaneously; a folder likewise.
Dock pins never interact with container uniqueness, widgets are not dockable,
and each id appears at most once.

## Folder model

V1 folders contain only app shortcuts — no nested folders, no widgets. This
deliberately avoids recursive trees, cycle detection and nested-folder UX
before the product needs them; the `children: EntityId[]` shape extends when
nesting arrives later.

## Layout delegation

Spatial legality is entirely the engines' job. The domain does not reimplement
overlap, out-of-bounds, span, duplicate-layout-id or rect checks; it calls
`validatePageLayout` from `@veladesk/desktop-engine` and wraps each engine
issue as `page-layout-invalid { pageId, issue }`, and — for pages that carry a
canvas — `validateCanvasLayout` from `@veladesk/canvas-engine`, wrapped as
`page-canvas-invalid { pageId, issue }`. When engine rules upgrade, the domain
validator automatically reuses them.

The domain additionally enforces the joins between the packages:

- `page.layout.id === page.id`;
- every placed item id — `pageItemIds(page)`, i.e. the canvas items when a
  canvas exists, the legacy layout items otherwise — must resolve to a
  `WorkspaceEntity` (`layout-entity-missing`);
- a page with a canvas must not also carry legacy items
  (`canvas-page-has-legacy-items`), so membership always has one source.

## Canvas pages (016-C)

Since Task 016-C a page may carry a continuous canvas instead of a grid:

- `DesktopPage.canvas?: CanvasLayout` — optional, so every snapshot persisted
  before canvas existed stays valid forever: without it the page is *legacy*
  and `layout.items` carries membership and geometry exactly as before;
- with it, the canvas is authoritative, `layout.items` must be empty, and the
  grid of `layout.grid` remains the section's snap lattice;
- `pageItemIds(page)` is the single membership helper every container rule
  uses; `resolvePageCanvas(page)` returns the stored canvas or a virtual one
  derived from legacy grid items (pure, never written by rendering);
- `materializePagePlacement(page)` is the one-way lazy upgrade into stored v2
  placement (legacy items emptied), performed by the
  first canvas-aware mutation (`addAppToPage`, `relocateAppToPage`,
  `dissolveFolderToPage`, `replacePageCanvas`, …) — there is no bulk database
  migration;
- `replacePageCanvas(workspace, pageId, canvas)` is the geometry write path. It
  refuses a canvas whose item id set differs from the page's current one: a
  canvas is geometry, not membership, so adding and removing stay in their own
  operations.

See [canvas-layout.md](./canvas-layout.md) for the coordinate model and the
placement rules.

## Validation semantics

`validateWorkspace` returns every discoverable issue as a
`WorkspaceValidationIssue` (a discriminated union); it never throws on invalid
data and never mutates the snapshot. Deterministic issue order:

1. workspace-level scalars
2. page identity/name/layout, then canvas exclusivity + canvas semantics
3. entity identity/name/basic scalars
4. category identity/name
5. layout references (canvas items when a canvas exists, legacy items else)
6. folder references
7. exclusive-container violations
8. dock
9. preferences/default page
10. app category references

Within a group, issues follow the source array order. Duplicate ids never
short-circuit the run: identity lookups (entity, page, category maps) resolve
to the **first occurrence**; later duplicates are reported as
`duplicate-*-id` issues and never overwrite the winner. Container uniqueness
counts **distinct** containers (an id twice inside one folder is a
`folder-child-duplicate`, not a container violation) and only for entities
that actually resolve. App URLs are only required to be non-empty strings —
no protocol allowlist, no `URL()` parsing — because VelaDesk is
trusted-LAN-first and custom protocols (`steam://`, `obsidian://`,
`vscode://`, …) must stay valid.

## Ordering

Array order carries business meaning throughout: `pages` (page switcher
order), `categories` (user-defined display order — there is deliberately no
`sortIndex`), `dock.items` (pin order) and `folder.children`. Consumers must
preserve array order; the domain never re-sorts.

## Persistence boundary

This model is not the SQLite schema. `WorkspaceSnapshot` is the business
aggregate used for validation, import/export, backup/restore and the UI's
mental model; database normalization (join tables, indexes, per-kind tables,
id generation) belongs to the future persistence layer. Nothing here should
be reshaped to anticipate a specific database layout.
