# Desktop Interaction Architecture

## Purpose

Task 003 introduces the first real desktop drag interaction for VelaDesk: free
pixel dragging with grid snapping applied only at drop time, an Arrange/View
mode pair that expresses the future product's layout lock, and engine-owned
undo/redo. The scope is a development-only interaction lab at `/lab/desktop`
plus a pure interaction-mapping package; it is explicitly not the final
product visual design.

## Responsibility split

```
Pointer / keyboard gesture (browser, dnd-kit sensors)
        ↓
dnd-kit (@dnd-kit/react 0.5.0)
  - gesture detection (PointerSensor + KeyboardSensor, default preset)
  - free pixel movement of the dragged element (Feedback plugin transform)
  - drag lifecycle (start / move / end / cancel events)
        ↓  event.operation.position.initial → .current  (pixel delta)
@veladesk/desktop-interaction  (pure TypeScript, no React / DOM / dnd-kit)
  - calculateGridPixelMetrics: container measurement → cell pixel geometry
  - dragDeltaToDesiredPosition: pixel delta + start cell → desired cell
        ↓  desired GridPosition
@veladesk/desktop-engine  (pure TypeScript)
  - moveItem(..., { placement: "nearest-free" }): clamping, collision,
    nearest-free resolution, layout invariants
  - commitLayout / undoLayout / redoLayout: snapshot history invariants
        ↓  new present layout
React UI (features/desktop-lab)
  - renders the logical layout as a CSS grid
  - ResizeObserver + getComputedStyle → calculateGridPixelMetrics
  - commits exactly once per successful drop
```

Each layer only talks to its neighbour through the typed boundary above:
the interaction package never imports React, DOM APIs or dnd-kit, and the
engine never knows pixels exist.

## Free drag, snap on commit

VelaDesk intentionally does **not** snap the visual drag transform during
pointer movement. While a drag is active, the PageLayout is untouched and the
dragged element simply follows the pointer (dnd-kit's Feedback plugin), giving
continuous free movement. Grid snapping happens only when the drag is
committed: on `DragDropProvider.onDragEnd`, the pixel delta
(`operation.position.current − operation.position.initial`) is converted to a
desired logical position, and the engine resolves it (empty target → snap
there, occupied → nearest free cell, out of bounds → clamp, no space → layout
unchanged).

Reasons for this design:

- Continuous free movement feels smoother; stepped per-cell jumping during
  the drag feels like a rigid dashboard widget, not a desktop.
- It keeps the 60 fps visual work in dnd-kit's transform updates instead of
  React re-renders — `onDragMove` never calls `setState`, `moveItem` or
  `commitLayout`.
- The logical layout only ever changes at drop time, so history snapshots
  (undo/redo) stay meaningful: one drag equals at most one history entry.
- A canceled drag (`event.operation.canceled`, e.g. Escape) skips the commit
  entirely, so the item returns to where the drag started.

## View mode / Arrange mode (layout lock basis)

The lab renders a View mode where every `useDraggable` is registered with
`disabled: true` and an Arrange mode where dragging is enabled. This is the
foundation of the product's future layout lock: the lock is a real
interaction-level state on the dnd-kit draggables, never a CSS
`pointer-events` trick. dnd-kit's default sensor set (pointer + keyboard) is
kept, so draggable items stay focusable and keyboard-operable.

## Pixel measurement

`useGridMetrics` (React layer only) observes the grid container with a
`ResizeObserver`, reads `getBoundingClientRect` and computed `column-gap` /
`row-gap`, and feeds them to the pure `calculateGridPixelMetrics`. Viewport
resizes therefore only update pixel metrics; the logical PageLayout is never
modified by a resize. Metrics state updates only when a measured value
actually changed.

## Rendering

The logical layout is rendered with CSS Grid (`grid-column: column + 1 /
span n`), so CSS owns presentation and the engine owns coordinates. No
absolute pixel positions are persisted anywhere.
