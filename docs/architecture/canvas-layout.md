# Canvas Layout (continuous rect geometry)

Task 016-C replaces the desktop's discrete grid placement with a continuous
canvas: an app tile is a free rectangle in resolution-independent logical
units, resized from eight handles, and a section chooses per section whether
that editing is aligned to a lattice or fully free.

## Responsibility

| Layer | Owns | Never touches |
| --- | --- | --- |
| `@veladesk/canvas-engine` | logical units, rect/layout validation, the grid-derived snap lattice, translation, resize math, canvas history, legacy grid→canvas conversion | React, DOM, IndexedDB, Node fs, Next |
| `@veladesk/domain` | `page.canvas`, the membership helper, lazy materialization, canvas-aware editing operations, canvas validation issues | pixels, CSS, gestures |
| `apps/web/features/canvas/` | pointer→logical conversion, `canvasRectStyle`, drag/resize sessions, the optimistic handoff, per-page arrange history | domain rules |
| `apps/web/features/home/` | rendering, selection, context menu, durable commits | rect math |

`@veladesk/desktop-engine` keeps its grid model unchanged: `/lab/desktop`
and its `LayoutHistory` still run on it.

## Logical units, not pixels

`CANVAS_UNITS = 10_000` spans each axis: the canvas is `(0,0)` to
`(10000,10000)`. Rect fields are safe integers, `width`/`height` are at
least `1`, and no rect may leave the canvas. Nothing about a rect depends on
the display, the window size or a device pixel ratio, so the same snapshot
renders identically everywhere. There is **no scale cap** — the only maximum
is the canvas itself, so an app can be a sliver or cover the whole section.

```ts
interface CanvasRect { readonly x, y, width, height: number }        // 0..10000
interface CanvasLayoutItem { readonly id: string; readonly rect: CanvasRect }
type CanvasPlacementMode = "snap" | "freeform";
interface CanvasLayout { readonly version: 1; mode; items: readonly CanvasLayoutItem[] }
```

Array order is the stable item order. **Overlap is legal everywhere** and is
never validated against: two apps may share a rectangle, in either mode.

## The page owns one geometry source

`DesktopPage.canvas` is optional. When it is absent the page is a *legacy*
page and `layout.items` (`position`/`span`) still carries both membership and
geometry — every snapshot written before canvas existed stays readable, with
no migration. When it is present the canvas is authoritative and
`layout.items` must be empty (`canvas-page-has-legacy-items` otherwise), so a
page can never have two membership lists. The grid of `page.layout.grid`
stays in both cases: it is the section's snap lattice.

`pageItemIds(page)` is the single membership helper — canvas ids when a
canvas exists, legacy layout ids otherwise. All container logic (validation,
deletion, relocation, launch order) goes through it.

`resolvePageCanvas(page)` is the read path used by rendering: the stored
canvas, or a **virtual** canvas derived from the legacy grid (mode `snap`,
edges rounded per lattice line). Derivation never writes, so rendering a
legacy page stays side-effect free; `materializePageCanvas(page)` performs
the one-way upgrade, and every mutation path calls it first, which is why the
first edit on an old page (drag, resize, add app, mode switch) silently
upgrades that page.

Because both paths render through the same resolver, the upgrade is
invisible: a legacy page's derived rects and its materialized rects are equal
by construction (the browser check measured a 0px delta on untouched items).

## Snap is alignment, not capacity

`snap` means edges and positions align to the lattice derived from the grid:

```
edgeX(i) = round(i / columns * CANVAS_UNITS)   // per edge, never accumulated
```

Rounding each edge independently is what keeps a 6-row section exact — adding
a rounded cell height six times would drift by several units.

Snap mode does **not** mean "this cell is taken". It never rejects a drop, it
never searches for free space (`findNearestFreePosition` is gone from the
production path), it never moves another app, and it does not resolve
overlaps. Placing an app, relocating one, dissolving a folder and nudging a
selection can therefore never fail for lack of room — `no-space` remains only
as legacy vocabulary in the failure union.

`freeform` means the section has no lattice at all: drags are continuous,
resizes are bounded only by the canvas, and arrange mode draws no markers.

## Placement and translation

A new item starts as one lattice cell at a deterministic cascade position:
the lattice diagonal in `snap` (cell `(n % columns, n % rows)`), an eighth of
a cell per step in `freeform`, clamped into the canvas. `relocateAppToPage`
preserves the source rect's size when the app came from another canvas page,
so a wide tile stays wide when it moves between sections.

Translations are resolved once for the whole selection:

- freeform: the raw logical delta, rounded, clamped once against the group's
  bounding box — the group stops at the canvas edge as a rigid body and never
  scatters item by item;
- snap: **one** delta computed by snapping a single anchor (the first
  selected item in canvas order) and reused by every selected item, so
  relative geometry survives; per-item snapping would tear a group apart.

## Matching the pointer, never fighting it

The pointer provides pixels; `CanvasPixelMetrics` (measured from the
`.vela-canvas` box) converts them to logical units. During a drag dnd-kit
owns the source transform, so the snap correction is written to the source as
a CSS custom property (`--vd-canvas-drag-preview` on the item body) while
peers receive the resolved translation directly — the source and its peers
therefore land in the same snapped position instead of drifting apart.

**Pointermove never persists anything.** Transient previews are DOM writes
(`.style` / custom properties); exactly one durable edit happens on release.
The browser check sampled the workspace revision during an eight-frame drag:
unchanged during the gesture, `+1` after the release.

## Legacy conversion

`materializePageCanvas` converts each legacy item with
`gridPositionToCanvasRect`, which computes all four edges from the lattice and
derives `width`/`height` from them (right − left, bottom − top) rather than
multiplying a rounded cell size — again to avoid accumulated error. The
legacy item list is emptied at that moment and the placed rects are unchanged.

## Canvas write path

`replacePageCanvas(workspace, pageId, canvas)` is the single geometry write:

- it refuses an invalid canvas and a canvas whose item **id set** differs from
  the page's current one (`invalid-page-layout`) — a canvas is geometry, not
  membership, so adding and removing live in their own operations;
- it materializes a legacy page first, so geometry commits upgrade pages too;
- it is immutable and keeps every other page's reference.

## Arrange history

`features/canvas/arrange-history.ts` keeps one `CanvasHistory` per page
(limit 50) from `@veladesk/canvas-engine/history`. It records geometry edits
only — **move and resize**, both undoable and redoable. Structural edits (add
app, delete app, section CRUD, appearance edits) and the placement-mode switch
are not recorded: their canvas diverges from the recorded one, and
`reconcilePageCanvasHistory` resets that page's branch instead of handing back
a canvas the user cannot reach.

## Optimistic handoff

`PendingCanvasHandoff { token, pageId, canvas }` shows the result of a move,
resize or mode switch immediately — before any IndexedDB promise resolves —
and is dropped only when the authoritative canvas is structurally equal (or
when the page vanished, or when a settled attempt landed somewhere else). A
refused stage is the one real revert. The token is the generation guard, so a
stale async completion can never clear a newer handoff.

## Verification

- Pure tests: `packages/canvas-engine/src/*.test.ts` (rect rules, lattice
  rounding, snap including degenerate rects and overlap, group translation and
  clamp, eight handles, Shift aspect, history), `packages/domain/src/
  canvas.test.ts` + `editing.test.ts` (membership, materialization,
  canvas-aware operations, validation issues, round-trip decoding),
  `apps/web/features/canvas/*.test.ts` (logical↔pixel conversion,
  `canvasRectStyle`, lattice markers, drag preview/commit, resize math,
  handoff rules, per-page history).
- Browser (production standalone build, real CDP input): a 7-app / 2-section
  fixture with square, landscape, portrait and overlapping rects renders on
  the canvas box; snap sections show 60/96 lattice markers in arrange and
  freeform sections none; a drag in freeform lands off-lattice while snap
  drags land on lattice lines; E/S/corner resizes move only the edges they
  own and snap per axis; Shift holds the freeform aspect ratio; a resize to
  near-full width and a 2%-wide rect are both legal; mode switches keep
  geometry identical going to freeform and snap every rect in one atomic edit
  going back; a legacy grid workspace renders and upgrades on its first drag.
