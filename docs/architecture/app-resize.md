# App Tile Resize (Arrange mode)

## Responsibility

Task 016-C replaces the icon-scale gesture with the one the product actually
wanted: in Arrange mode, selecting a single app shows **eight** handles, and
dragging any of them resizes the app's real box. Task 017 splits the
semantics per placement mode: **freeform** keeps the continuous rectangle
(width, height, both, any ratio, Shift aspect lock); **grid** resolves
whole-cell spans — E/W change `columnSpan` only, N/S change `rowSpan` only,
corners change both, minimum 1×1, no Shift (aspect locking never applies to
spans). See [canvas-layout.md](./canvas-layout.md) for the geometry model.

| Owns | Never touches |
| --- | --- |
| `CanvasRect` of one app (x, y, width, height) | `AppVisualStyle.iconScale` (a glyph multiplier, unchanged) |
| the transient DOM preview during the gesture | folder sizes, group resize (not a feature) |
| the commit handoff around the durable stage | the grid definition, other items, z-order |
| the arrange `CanvasHistory` entry | mode, dock, appearance |

`iconScale` is untouched by this gesture and keeps its legacy meaning: a
multiplier for the glyph *inside* the tile (see
[app-visual-system.md](./app-visual-system.md)).

## Layers

| Layer | File | Owns |
| --- | --- | --- |
| Pure math | `features/canvas/canvas-resize.ts` | handle list, cursors, session shapes (freeform rect / grid spans), pointer→geometry math, no-op detection |
| Engine math | `packages/canvas-engine/src/resize.ts` + `grid.ts` | which edges a handle moves, bounds, minimum size, Shift aspect lock (freeform); span semantics and column bounds (grid) |
| Gesture | `features/home/desktop-item.tsx` | handle markup, pointer capture, transient rect preview, Escape/cancel |
| Commit | `features/home/desktop-shell.tsx` | one `replacePageCanvas`, one stage, one sync, the history entry |
| CSS | `features/home/home-shell.css` | handle geometry, cursors, layer pointer rules |

## When handles appear

```
arrange == true
AND single selection (selectedItemIds.size === 1)
AND entity.kind === "app"          ← folders and widgets never resize
AND no pending canvas handoff
AND not dragging
```

View mode renders no handles, and a multi-selection renders none either —
group drag stays available, group resize is explicitly not a feature. The
shell computes the eligible set (`resizableIds`); the item adds only the "not
dragging" and "not resizing something else" conditions.

A LIVE session deliberately keeps the handles mounted: they hold the pointer
capture, so unmounting them would drop the gesture mid-drag. Only the commit
handoff (after pointerup) hides them.

## Eight handles, not four

| Handle | Moves | Cursor |
| --- | --- | --- |
| `nw` | left + top edges | `nwse-resize` |
| `n` | top edge (height only) | `ns-resize` |
| `ne` | right + top edges | `nesw-resize` |
| `e` | right edge (width only) | `ew-resize` |
| `se` | right + bottom edges | `nwse-resize` |
| `s` | bottom edge (height only) | `ns-resize` |
| `sw` | left + bottom edges | `nesw-resize` |
| `w` | left edge (width only) | `ew-resize` |

Four corners alone would make a single-axis change require a diagonal drag;
the product asks for real rectangles, so each axis has its own handle. The
layer over the item is `pointer-events: none` and only the handles take
pointers, so grabbing the tile still drags it.

## The gesture

1. `pointerdown` on a handle runs in the **capture phase** and calls
   `preventDefault()` + `stopPropagation()`. This is load-bearing: dnd-kit
   attaches its own native `pointerdown` listener to the draggable button, and
   a native listener on the button runs before React's root-level bubble
   handlers — stopping propagation from a bubble handler would be too late and
   the tile would start DRAGGING instead of resizing.
2. The session snapshots the start rect, the pointer origin, the canvas pixel
   metrics, the grid and the section's placement mode.
3. The handle captures the pointer, so `pointermove` keeps arriving even when
   the pointer leaves the handle box (`touch-action: none` keeps the browser
   from claiming the gesture).
4. Every `pointermove` writes `left/top/width/height` straight onto the item
   element — no React render per frame, and **no workspace mutation, no stage,
   no sync, no history entry**.
5. `pointerup` commits (below). `pointercancel`, `lostpointercapture` or
   Escape cancels: the authoritative rect is written back, and nothing is
   staged or synced.

## The math

```
deltaUnits = pixelsToUnits(pointerDelta, canvasExtent)
rect       = resizeCanvasRect({ start, handle, deltaX, deltaY, constrainAspect })
rect       = freeform: continuous rect math (grid mode resolves cell spans instead)
```

`resizeCanvasRect` moves only the edges the handle owns, clamps them to
`0..CANVAS_UNITS`, and keeps a minimum extent of one logical unit — the 18px
hit area around an 8px dot is CSS, never a domain minimum. There is no grid
snapping and no aspect constraint unless Shift is held, so `e` on a square
produces a landscape rect and `s` produces a portrait one.

**Shift** (corner handles only) keeps the start aspect ratio: the axis that
moved more relative to the start rect drives the other, so dragging a corner
up shrinks both dimensions and dragging it sideways widens both. Edge handles
ignore Shift — they only ever change one axis.

In `grid` mode whole CELLS win: pointer pixels become cell deltas through the
pitch and spans change in whole units (so an
`e` drag lands on the next column line, an `s` drag on the next row line, and
a corner on both), and the preview is snapped too, so what the user sees while
dragging is exactly what commits. A rect that collapses is expanded to the
nearest single lattice interval.

A gesture that resolves back to the start rect is a no-op: no handoff, no
stage, no sync, no history entry.

## The commit (one per gesture)

`pointerup` produces at most one `replacePageCanvas`, one local stage and one
sync attempt. The optimistic handoff (see
[canvas-layout.md](./canvas-layout.md)) shows the final rect before IndexedDB
is written, so the frame the pointer released on is the frame the user keeps
seeing — there is no final → old → final flash, and a refused stage is the
only real revert.

## Interaction lock

While a resize session is live the desktop locks:

- no DnD drag may start (and no drag handle is registered),
- no marquee selection, no keyboard nudge, no undo/redo, no select-all,
- no mode switch, no section switch,
- the section stack carries `data-scroll-locked`, so a wheel or trackpad
  gesture cannot page sections.

Escape is consumed by the resize (cancel) instead of clearing the selection.
The lock is deliberately short — it ends with the gesture — and native scroll
snapping resumes immediately afterwards.

## Accessibility

Handles are non-focusable `role="button"` elements labelled 调整图标大小 /
Resize icon. This task does not implement keyboard resizing, and the handles
only exist in Arrange mode — View mode accessibility is untouched.

## Verification

- Pure tests: `apps/web/features/canvas/canvas-resize.test.ts` (all eight
  handles, cursors, single-axis moves, corner anchoring, bounds, minimum size,
  snap per axis, Shift aspect and its edge-handle exemption, no-op detection),
  `packages/canvas-engine/src/resize.test.ts` (the same math at the engine
  level, including ratio preservation after rounding).
- Browser (production standalone build, real CDP input): eight handles on one
  selected app and none for a multi-selection; `e` changes only the width and
  `s` only the height; corners change both; a snap section lands on lattice
  lines per axis while a freeform section reaches arbitrary sizes; Shift keeps
  the freeform ratio (6.276 → 6.274); a rect reaches nearly the full canvas
  width and a 2%-wide sliver stays legal; pointers keep working ~250px away
  from the handle; Escape and pointercancel leave zero writes; one gesture
  produces exactly one durable write.
