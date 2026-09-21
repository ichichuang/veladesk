# Arrange Session

Task 012 turned arrange mode into a small editing session: multi-select,
rigid group movement, and undo/redo of geometry — all session-only, all
local-first. Since task 017 the session edits versioned placements (integer
Grid cells or continuous freeform rects)
instead of grid cells, and it also owns the per-section placement mode.

## Responsibility

- `@veladesk/canvas-engine` owns the geometry: `translateCanvasItems` moves a
  whole selection as one rigid body with a single clamp,
  a grid section rounds pointer pixels to whole cells and clamps the group
  inside the columns, and
  `resizeCanvasRect` changes the edges a handle owns. See
  [canvas-layout.md](./canvas-layout.md).
- The web arrange session (`apps/web/features/`) owns selection, transient
  gestures and history: `features/home/selection-geometry.ts` (marquee math),
  `features/home/selection-state.ts` (set transitions),
  `features/desktop-grid/group-drag.ts` (source/selection → drag ids),
  `features/canvas/use-canvas-drag.ts` (the drag session),
  `features/canvas/arrange-history.ts` (per-page `CanvasHistory` map +
  reconcile + structural reset).
- `@veladesk/client-runtime` owns durable local staging.
- `@veladesk/sync` owns remote persistence.

## Selection

Selection is session-only React state over the CURRENT page's item ids
(`pageItemIds`) — never written to the workspace snapshot, IndexedDB, the
server or localStorage. In arrange mode a plain click selects one item,
Cmd/Ctrl click toggles, a rubber-band marquee selects positively-intersecting
items (edge touching excluded, < 4 px counts as a blank click: plain clears,
additive keeps), and Cmd/Ctrl+A selects the whole page. Escape, page switches
and leaving arrange clear it; ids removed from the page are normalized away.

## Group movement

A drag moves the whole selection by ONE translation: freeform takes the raw
logical delta (rounded) and clamps it once against the group's bounding box, so
the group stops at a canvas edge as a rigid body instead of scattering;
`grid` rounds the pointer delta to whole cells and reuses that single delta for every selected
item, which keeps a mixed-size group's relative geometry intact. Unselected
items keep their references, and a translation that resolves to zero is a
no-op (no handoff, no history entry, no sync).

Overlap is never a failure: translation can land on another app, and nothing
is pushed aside. A selection that runs into the canvas boundary stops as a
whole.

## Drag

During a drag only visuals move: dnd-kit owns the source transform, peers get
the resolved translation as a CSS custom property on their body
(`--vd-canvas-drag-preview`), and the source carries the correction between
the raw pointer delta and the resolved one — so a snapped group's source and
peers stay together. Never a workspace write, never a stage, never a history
entry (the browser check sampled the workspace revision mid-gesture: it does
not move). The drop is the single commit: resulting canvas → optimistic
handoff → `replacePageCanvas` → stage → sync. Cancels, mid-drag canvas
resizes, stale canvases and failed stages leave no trace; previews are always
cleared.

## Placement mode

Each section persists its own mode in its v2 placement (grid or freeform),
so one section can stay structured while another is free. The arrange
toolbar carries the primary switch (网格 / 自由) plus the gap stepper and
undo/redo; the arrange context menu offers the same choice with the active
entry checked, and View mode offers no placement controls at all — View
renders the persisted geometry and lets it be edited later.

Switching to `freeform` converts each grid item back through the lattice —
and is REFUSED (toolbar disabled with a localized reason) when content
extends beyond the freeform viewport, because that conversion would be
lossy; geometry is never silently compressed. Switching to `grid` snaps
every freeform rect onto the lattice in ONE atomic workspace edit (edge
indexes → cells). Either switch is structural and is therefore not
undoable — the page's history restarts at the new placement. A toolbar gap
change is a preference edit, not page geometry history: one durable write
per completed change, previewed immediately.

## History

One canvas history per page (limit 50) lives only for the browser session:
reload clears it, switching pages does not. It records **move and resize** —
both undoable and redoable, including a resize performed with the handles.
Commits are serialized and staged first: the candidate history is accepted
only after `stageWorkspaceUpdate` succeeds, so a refused stage rolls back by
simply not accepting it. Undo/Redo themselves are new local edits and sync
normally.

## Undo scope v1

Structural edits are deliberately invisible to arrange history: app
add/edit/delete, folder operations, renames, dock pins, section CRUD,
appearance edits and the placement-mode switch. Their canvas differs from the
recorded one, so reconciliation resets that page's branch rather than offering
an undo that would resurrect items the edit removed. `iconScale` stays out of
history too — it is a visual multiplier, not geometry
(see [app-visual-system.md](./app-visual-system.md)).

## Reconciliation

After every workspace change the active page's geometry is reconciled: a
structurally identical canvas with a fresh reference (server ack, IndexedDB
round-trip) only rebases `present` — past and future survive. A canvas that
differs resets that page's history. This is also what keeps undo safe across
an edit made in another tab.

## Local-first

Group drags, resizes, nudges, undo and redo all follow the same contract as
every other edit: pure operation → local stage → UI → explicit sync attempt.
Offline the UI changes immediately and the workspace goes dirty/Pending-Offline;
conflicts keep local editing fully available. Opening or closing the global
launcher itself never modifies the arrange selection or history.
