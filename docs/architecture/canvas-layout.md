# Canvas Layout (versioned placement: Grid v2 / Freeform v2)

Task 017 replaces the "continuous canvas with optional snapping" model with
a **versioned placement model**: a true integer square-cell **Grid** mode
for structured arrangement and the continuous **Freeform** mode for
unrestricted positioning. `CanvasLayout` is a union:

```ts
interface CanvasLayoutV1 { version: 1; mode: "snap" | "freeform"; items: CanvasLayoutItem[] }
interface GridCanvasLayoutV2 { version: 2; mode: "grid"; columns: number; items: GridCanvasItem[] }
interface FreeformCanvasLayoutV2 { version: 2; mode: "freeform"; items: CanvasLayoutItem[] }
type CanvasLayout = CanvasLayoutV1 | GridCanvasLayoutV2 | FreeformCanvasLayoutV2;

interface GridCanvasItem {
  id: string; column: number; row: number;   // 0-based cell origin
  columnSpan: number; rowSpan: number;        // whole cells, >= 1
}
interface CanvasLayoutItem { id: string; rect: CanvasRect } // 0..10000 units
```

v1 keeps its exact historical shape so every persisted snapshot stays
decodable. **Overlap is legal everywhere** and is never validated against,
in either mode.

## Responsibility

| Layer | Owns | Never touches |
| --- | --- | --- |
| `@veladesk/canvas-engine` | logical units, versioned validation, Grid cell arithmetic (translation/resize/first-free placement), the lattice used for v1→v2 conversion, canvas history | React, DOM, IndexedDB, Node fs, Next, **pixels** |
| `@veladesk/domain` | `page.canvas`, the canonical placement resolver, lazy materialization, placement-aware editing operations | pixels, CSS, gestures |
| `apps/web/features/canvas/` | square-grid pixel metrics, pointer→cell/rect conversion, drag/resize sessions, the optimistic handoff, per-page arrange history | domain rules |
| `apps/web/features/home/` | rendering (CSS Grid host / percent canvas), selection, toolbar, durable commits | geometry math |

`@veladesk/desktop-engine` keeps its grid model unchanged: `/lab/desktop`
and its `LayoutHistory` still run on it.

## Grid v2 integer geometry

- `columns` is a positive safe integer and **persistent layout structure**.
  The browser derives the physical square from the available width, never
  the other way around — resizing the window changes the cell size, never a
  logical column/row.
- `column`/`row` are safe integers `>= 0`; spans are safe integers `>= 1`;
  `column + columnSpan <= columns`.
- **Rows are unbounded**: `row` has no maximum, content grows downward, and
  the right-side section scroller owns the vertical scrolling.
- Duplicate ids are invalid; overlap is not a validation error.
- Validation issues come back through `validateCanvasLayout` (dispatches by
  version): `invalid-columns`, `invalid-grid-item` with problems
  (`not-safe-integer`, `negative-position`, `span-below-minimum`,
  `exceeds-columns`), `duplicate-item-id`; freeform keeps the v1 rect rules.

## One canonical resolver

`resolvePagePlacement(page)` in `@veladesk/domain` is the single production
placement source. Read behavior, pure — rendering never writes:

- v2 grid / v2 freeform: used directly (identity);
- v1 `snap`: lazily derived as v2 grid through the page grid lattice — each
  rect edge maps to its nearest lattice edge **index** (never through
  pixels), span from the edge distance, degenerate spans expand to one cell;
- v1 `freeform`: derived as v2 freeform with the rects unchanged;
- legacy `layout.items` without a canvas: derived as v2 grid exactly from
  the stored `GridPosition`/`GridSpan`.

`pageItemIds(page)` remains the single membership source across all three
eras. Once a page carries v2 placement, `page.layout.items` stays empty
(`materializePagePlacement` empties it during the one-way upgrade);
`page.layout.grid` survives as the conversion lattice.

## Responsive square-cell metrics (web)

`calculateSquareGridMetrics({ availableWidthPx, columns, gapPx })` computes

```
cellPx = (availableWidthPx - gapPx * (columns - 1)) / columns   // finite, > 0
pitchPx = cellPx + gapPx                                        // drag/resize pitch
```

from the measured `.vela-grid-stage` width (the scroller keeps a stable
scrollbar gutter, so the width never jitters). The renderer sets
`--vd-grid-cell-size` / `--vd-grid-gap` on the stage and the host uses
`grid-template-columns: repeat(columns, minmax(0, 1fr))`,
`grid-auto-rows: var(--vd-grid-cell-size)`, `gap: var(--vd-grid-gap)`;
each item emits `gridColumn`/`gridRow` (1-based line + explicit span), so
a 2×1 item is exactly `2 * cellPx + gapPx` wide. No fixed row count, no
one-screen canvas height — content rows grow automatically and an empty
grid still fills the visible height (`min-height: 100%`).

The visible Arrange+Grid overlay is a quiet ~1px background pattern sized
by `calc(var(--vd-grid-cell-size) + var(--vd-grid-gap))` —
`pointer-events: none`, opacity-only entrance, gone in View mode and in
freeform. The v1 center-dot lattice is deleted.

## The global grid gap

`preferences.gridGapPx` (integer 0..32, default 16, UI step 4, resolved by
`resolveGridGapPx`) is a real geometry input — it changes item pixel
dimensions, drag pitch, resize pitch, content height and the visible grid —
which is why it lives on `WorkspacePreferences`, not inside appearance.

## Editing semantics

**Grid drag**: pointer pixels → whole cells through the pitch
(`pixelsToCellDelta` rounds); `clampGridTranslation` clamps ONE rigid delta
horizontally inside the columns and at `row >= 0` (no maximum); groups
never scatter. **Grid resize**: all eight handles stay — E/W change
`columnSpan` only, N/S change `rowSpan` only, corners both; west/north
handles move origin and span together, edges never cross the opposite edge,
minimum 1×1, horizontal bound is the column count, the vertical bottom is
unbounded. **Shift aspect locking is a freeform behavior only** — Grid
spans never get ambiguous aspect semantics. Pointermove is preview only;
pointerup produces at most one durable write (a no-op produces none).

**New item placement**: Grid pages place new apps/folders at the first free
row-major location for their span (default 1×1; a preserved span is clamped
into the columns). Rows are unbounded, so Grid creation never fails for
space — `no-space` stays only as legacy vocabulary in the failure union.
Freeform pages keep the continuous cascade (an eighth of a cell per step).

**Freeform** keeps the pre-017 model unchanged: continuous rects in 0..10000
units, eight-handle resize with Shift aspect lock, one clamped group delta.

## Mode switch and the lossless boundary

Switching to Grid snaps every freeform rect onto the page lattice in ONE
atomic edit (edge indexes → cells). Switching to Freeform converts each
grid item back through the same lattice — but the freeform canvas is only
one viewport tall (`grid.rows` lattice rows), so any item whose row bottom
exceeds the row count would clamp and be **lossy**. `canConvertGridToFreeform`
refuses those conversions and the UI disables the switch with a localized
reason; geometry is never silently compressed or dropped. Both switches are
structural: the page's arrange history restarts.

## Write path, history, handoff

`replacePageCanvas(workspace, pageId, canvas)` stays the single geometry
write: it refuses invalid canvases and id-set changes, and materializes
legacy/v1 pages first (so geometry commits upgrade pages). Grid move and
resize are geometry edits in the per-page arrange history (one entry per
completed gesture, none for no-ops); gap preference changes are not page
history. `PendingCanvasHandoff { token, pageId, placement }` keeps the
optimistic drop handoff semantics — resolved placements are compared
structurally (`areCanvasLayoutsEqual` handles all versions), never by the
object identity of a derived legacy placement.

## Compatibility path

| Persisted shape | Read as | First geometry-aware mutation |
| --- | --- | --- |
| legacy `layout.items` | derived v2 grid from GridPosition/Span | materializes v2 grid, empties legacy items, untouched items do not move |
| v1 `snap` | derived v2 grid via lattice edge indexes | same upgrade, membership preserved |
| v1 `freeform` | derived v2 freeform, rects unchanged | upgrades to stored v2 freeform |

No database schema change, no bulk snapshot migration, no destructive
persistence rewrite.

## Verification

- Pure: `packages/canvas-engine/src/grid.test.ts` (validation, unbounded
  rows, column bounds, 1×1 minimum, rigid translation, eight-handle span
  semantics, no-op identity, first-free row-major, v1 snap→v2 conversion,
  lossless boundary), domain `canvas.test.ts`/`editing.test.ts` (resolver
  for all eras, materialization, placement-aware ops, gap preference),
  `apps/web` (square metrics, cell-square invariant, gap geometry,
  pixel→cell delta, CSS placement, content rows/height, wheel accumulator,
  scroll restore, hidden iconSize, static CSS contracts).
- Browser (production standalone, real CDP input): the task-017 fixtures —
  mixed 1×1/2×1/1×2/2×2 page, a 34-app multi-viewport page, a freeform
  page, long section names, a dock, an uploaded-image app and a
  library-icon app — exercised all 42 acceptance checks including measured
  square cells (84.33px at 12 columns/16px gap on 1440×900), gap 16→20
  geometry consistency, gutter stability, one-write-per-gesture revisions,
  and the legacy/v1 upgrade paths.
