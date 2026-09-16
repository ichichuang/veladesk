# Desktop Engine

## Purpose

`@veladesk/desktop-engine` is the pure-logic layout core of the VelaDesk
desktop. It is written in dependency-free TypeScript with zero runtime
dependencies and no imports from React, the DOM, dnd-kit, persistence layers,
or animation libraries.

The separation is deliberate. The same engine will later serve:

- the React desktop UI (rendering layout state),
- a dnd-kit drag adapter (translating pointer gestures into engine calls),
- SQLite persistence and IndexedDB local state (storing layout snapshots),
- undo / redo, widgets, folders, responsive layouts, tests, import / export.

Because every consumer shares this one core, placement rules cannot drift
between UI code, persistence code, and tests. The engine's API is therefore
deterministic, immutable, and easy to test; interaction and rendering concerns
live outside it. dnd-kit in particular will be integrated later as an
interaction adapter — the engine remains the source of truth for logical grid
placement and layout invariants.

## Coordinate system

- All coordinates are **0-based logical grid cells**. The top-left cell is
  `column: 0, row: 0`.
- Positions are top-left anchors (`GridPosition`); sizes are cell spans
  (`GridSpan`).
- There are **no pixels, no x/y fields, and no CSS** in the engine. Mapping
  logical cells to pixels is exclusively the UI layer's job.

## Item model

`LayoutItem` owns exactly three things: `id`, `position`, `span`.

Business metadata — app identifiers, URLs, titles, icons, folder contents,
widget configuration, page or database id mappings — never enters the engine.
A `PageLayout` is a page id, a `GridDefinition` (columns × rows), and an
ordered list of layout items. This keeps snapshots small, comparable, and
portable across persistence formats.

## Placement rules

Two placement strategies exist for `moveItem`:

- **`exact`** (default): the desired anchor is used as given. If the rect is
  out of bounds the operation fails with `out-of-bounds`; if it collides with
  another item it fails with `collision`. The input layout is never modified.
- **`nearest-free`**: the desired anchor is clamped into the grid first
  (`clampPositionToGrid`, which throws `RangeError` for spans that cannot fit
  the grid at all and never silently shrinks a span), then the closest free
  anchor is resolved.

Nearest-free resolution is deterministic:

1. Distance is **squared Euclidean distance**:
   `dc * dc + dr * dr` between a candidate anchor and the clamped desired
   anchor.
2. **Ties break by smaller row first, then smaller column.** This rule is
   implemented by scanning candidate anchors in row-major order and only
   replacing the best candidate when the distance is *strictly* smaller. It
   does not depend on object key order, `Set` iteration order, or randomness.
3. If no anchor fits, `findNearestFreePosition` returns `null` and `moveItem`
   fails with `no-space`.

## Collision model

Collision detection is rectangle-based over cells. An item with span
`columns × rows` occupies exactly that many cells. Two rects overlap only if
they share at least one cell; **rects that merely touch along an edge or a
corner never overlap** (half-open interval comparison).

`buildOccupancyMap` materializes the cell → item-id map. If the input items
already overlap each other, it throws an error naming both conflicting item
ids instead of silently overwriting a cell.

`validatePageLayout` reports all discoverable issues of a layout (duplicate
ids, invalid positions/spans, out-of-bounds items, overlap pairs) as a
discriminated-union list in deterministic order, instead of throwing.

## Immutability

All engine operations are pure with respect to their inputs:

- No operation mutates the input layout, its items, or a history object.
- Successful operations return a new `PageLayout`; untouched items keep their
  object references; only changed items are copied.
- A move to the item's current position returns the **original layout
  reference** rather than a new snapshot.
- Failed operations return the input layout unchanged alongside a reason.

## History

Layout history currently uses a **snapshot model**: `LayoutHistory` keeps up
to `limit` (default 50) past `PageLayout` snapshots, the present snapshot, and
the redo branch. Commits that are semantically equal to the present
(`arePageLayoutsEqual`) are ignored; a real commit clears the redo branch.

This is intentionally simple and is **not** a cloud-sync command protocol.
Any future collaboration or sync protocol will be designed separately; the
snapshot model makes no promises in that direction.

## Complexity

`findNearestFreePosition` is currently an **exhaustive grid scan**: it visits
every legal anchor, checks collisions, and keeps the best candidate by
distance. `validatePageLayout` pairwise overlap checking is O(n²) in the item
count; `buildOccupancyMap` is linear in covered cells.

This is a deliberate design decision: personal desktop grids are small
(typically dozens of cells), and correctness plus deterministic behavior take
priority over premature optimization. No asymptotic improvements are claimed
that have not been implemented and measured.

## Future integration notes

Capabilities that are intentionally **not** implemented yet:

- dnd-kit drag adapter (pointer events → desired grid positions, then
  `moveItem` / `clampPositionToGrid`).
- Persistence (SQLite schema, API, localStorage, IndexedDB).
- Responsive layouts / grid resizing on viewport changes.
- Folders, dock behavior, and widget UI.
- Automatic reflow / push-away algorithms when items collide.
- Import / export of layouts.

Each of these will consume the engine's public API; none of them should
require engine-internal knowledge.
