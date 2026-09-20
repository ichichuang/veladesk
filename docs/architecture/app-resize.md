# App Icon Resize (Arrange mode)

## Responsibility

Task 016-C replaces the visual editor's size slider with the gesture the
product actually wanted: in Arrange mode, selecting a single app shows
four corner handles, and dragging any of them scales the icon the way a
desktop object or a design tool behaves.

The whole feature is **uniform visual scale**, not layout resizing:

| Owns | Never touches |
| --- | --- |
| `AppShortcut.visual.iconScale` (0.5–2.0) | `LayoutItem.position` |
| the transient DOM preview during the gesture | `LayoutItem.span` |
| the commit handoff around the durable stage | `GridDefinition`, collision, nearest-free, drag metrics |
| | `LayoutHistory` (movement-only, unchanged) |

A 200% icon still occupies its 1×1 logical slot; it simply overflows it
visually.

## Layers

| Layer | File | Owns |
| --- | --- | --- |
| Pure math + handoff | `features/home/app-resize.ts` | session geometry, clamping, no-op epsilon, the resizable-entity rule, the commit handoff |
| Pointer session | `features/home/desktop-item.tsx` | handle markup, pointer capture, transient CSS variable, Escape/cancel |
| Lock + durable commit | `features/home/desktop-shell.tsx` | one `replaceApp`, one stage, one sync attempt, the desktop-wide resize lock |
| CSS | `features/home/home-shell.css` | handle geometry and `--vd-app-icon-effective-scale` |

## When handles appear

```
arrange == true
AND single selection (selectedItemIds.size === 1)
AND entity.kind === "app"          ← folders and widgets never resize
AND no live layout handoff
AND no pending resize handoff      ← never start a session on a pending scale
AND not dragging
```

View mode renders no handles at all. Multi-selection renders none either
(group drag stays available; group resize is explicitly not a feature).
The shell computes the eligible set (`resizableIds`); the item adds only
the "not dragging" and "not resizing something else" conditions.

A LIVE session deliberately keeps the handles mounted: they hold the
pointer capture, so unmounting them would drop the gesture mid-drag. Only
the commit handoff (which happens after pointerup) hides them.

## The gesture

1. `pointerdown` on a handle runs in the **capture phase** and calls
   `preventDefault()` + `stopPropagation()`. This is load-bearing: dnd-kit
   attaches its own native `pointerdown` listener to the draggable button,
   and a native listener on the button runs before React's root-level
   bubble handlers — stopping propagation from a bubble handler would be
   too late and the tile would start DRAGGING instead of resizing.
2. A session is created from the tile's visual center (the anchor) and the
   pointer's distance to it. A start distance under 4px is refused.
3. The handle captures the pointer, so `pointermove` keeps arriving even
   when the pointer leaves the handle box.
4. Every `pointermove` writes `--vd-app-icon-scale-preview` directly to
   the tile's wrapper element — a CSS custom property inherits, so the
   tile re-renders at the new size without React rendering anything.
   **No workspace mutation, no stage, no sync, no history entry happens
   during the gesture.**
5. `pointerup` commits (see below). `pointercancel`,
   `lostpointercapture`, or Escape cancels: the preview variable is
   removed, the persisted scale is untouched, and nothing is staged or
   synced.

## The math

```
currentDistance = hypot(pointerX - centerX, pointerY - centerY)
nextScale       = clamp(startScale * currentDistance / startPointerDistance, 0.5, 2.0)
```

Uniform by construction: only the DISTANCE from the anchor matters, never
the pointer's angle. All four corners therefore share one code path — a
corner can both grow and shrink, and the icon can never be dragged into a
rectangle. Non-finite pointer math degrades to the start scale, and the
clamp guarantees the persisted value is always a finite number in
0.5–2.0 (never NaN, 0 or Infinity).

A change smaller than 0.005 is a no-op: no handoff, no stage, no sync.

## The commit (one per gesture)

`pointerup` produces at most:

- one `replaceApp(snapshot, withIconScale(app, finalScale))`,
- one local workspace stage,
- one sync attempt.

Sub-epsilon gestures produce none of them. `withIconScale` replaces only
`visual.iconScale`; the icon, decoration, colors and the entire page
layout are carried over unchanged.

### Handoff: no rebound

The committed scale is displayed IMMEDIATELY — before any IndexedDB
promise is awaited — through a `PendingResizeHandoff { token, appId,
scale }`. The transient CSS variable stays in place until the handoff
resolves, so the frame the pointer released on is the frame the user
keeps seeing. Measured in the browser the last preview width and the
settled width differ by 0.000px; there is no final → old → final flash.

The handoff is dropped exactly when the authoritative snapshot carries
the same scale. A settled attempt whose scale never matched (a refused
stage) drops it too — that is the only real revert, and the tile returns
to the persisted size. The token is the generation guard: a stale async
completion can never clear a newer handoff.

## Interaction lock

While a resize is live, or while its commit handoff is pending, the
desktop locks:

- no DnD drag may start (and no drag handle is registered),
- no marquee selection, no keyboard nudge, no undo/redo, no select-all,
- no mode switch, no section switch,
- the section stack carries `data-scroll-locked`, so a wheel or trackpad
  gesture cannot page sections.

Escape is consumed by the resize (cancel) instead of clearing the
selection. The lock is deliberately short: it ends the moment the local
stage lands, never waiting for a server sync, and native scroll snapping
resumes immediately afterwards.

## Accessibility

Handles are non-focusable `role="button"` elements labelled 调整图标大小 /
Resize icon. This task does not implement keyboard resizing, and the
handles only exist in Arrange mode — View mode accessibility is
untouched.

## History

Arrange history (task 012) still records `PageLayout` movement only. An
icon resize never enters it, and it was not widened into a
workspace-wide command history.

## Verification

- Pure tests: `features/home/app-resize.test.ts` (start distance, grow,
  shrink, all four corners, min/max clamp, invalid start, no-op epsilon,
  the resizable-entity rule, handoff keep/caught-up/settled-drop,
  position/span untouched).
- Browser (production standalone build, real CDP input): four handles on
  a single selected app and none in View mode or multi-selection; all
  four corners grow and shrink; pointer capture keeps scaling ~250px away
  from the handle; Escape cancels with zero writes; the clamps land on
  0.5 and 2.0; 24 pointer frames produce zero stages and the commit
  produces exactly one stage and one sync attempt; the grid cell, slot
  size and grid definition are byte-identical at 200%; resize → drag →
  reload preserves both position and scale; the section stack is locked
  during the gesture and pages normally afterwards.
