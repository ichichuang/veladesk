# Arrange Session

Task 012 turns arrange mode into a small editing session: multi-select,
rigid group movement, and a movement-only undo/redo — all session-only,
all local-first.

## Responsibility

- `@veladesk/desktop-engine` owns group spatial legality:
  `moveItems(layout, itemIds, translation)` moves a whole selection as one
  rigid body (exact or nearest-free) with typed failures, exactly like
  `moveItem`.
- The web arrange session (`apps/web/features/home/`) owns selection,
  transient gestures and layout history: `selection-geometry.ts`
  (marquee math), `selection-state.ts` (set transitions),
  `group-drag.ts` (source/selection → drag ids, desired → translation),
  `arrange-history.ts` (per-page `LayoutHistory` map + reconcile).
- `@veladesk/client-runtime` owns durable local staging.
- `@veladesk/sync` owns remote persistence.

## Selection

Selection is session-only React state over the CURRENT page's layout
items — never written to the workspace snapshot, IndexedDB, the server or
localStorage. In arrange mode a plain click selects one item, Cmd/Ctrl
click toggles, a rubber-band marquee selects positively-intersecting
items (edge touching excluded, < 4 px counts as a blank click: plain
clears, additive keeps), and Cmd/Ctrl+A selects the whole page. Escape,
page switches and leaving arrange clear it; ids deleted from the layout
are normalized away.

## Group movement

`moveItems` applies ONE rigid integer translation to every selected item:
ids, spans, array order and relative geometry are preserved; unselected
items keep their references. Exact placement fails atomically with
`out-of-bounds` / `collision` (deterministic, deduped colliding ids);
nearest-free enumerates the bounded rigid-translation space of the whole
group — never per-item placement — ordering candidates by squared
distance to the desired translation, then translated group top row, then
left column. Zero translations return the original layout reference.
Single-item sessions delegate to `moveItem` and stay equivalent.

## Drag

During a drag only visuals move: dnd-kit owns the source transform and
the hook translates every other selected peer with a transient CSS
transform (`onDragMove`) — never a workspace write, never a stage, never
a history entry. The drop is the single commit: pixel delta → grid
desired → rigid translation → engine `moveItems` nearest-free → replace
→ stage → sync. Cancels, mid-drag resizes, stale layouts and failed
stages leave no trace; peer transforms are always cleared.

## History

One engine `LayoutHistory` per page (limit 50, engine defaults),
lives only for the browser session — reload clears it, switching pages
does not. Commits are serialized and staged first: the candidate history
is accepted only after `stageWorkspaceUpdate` succeeds, so a refused
stage rolls back by simply not accepting. Undo/Redo themselves are new
local edits and sync normally.

## Undo scope v1

Arrange history records page-layout MOVEMENTS only — single drag, group
drag, keyboard nudge. It is not a workspace-wide command history: app
add/edit/delete, folder operations, renames, dock pins and icon RESIZING
(016-C) are invisible to it, and the UI labels it "arrange" accordingly.
An icon resize writes `AppVisualStyle.iconScale` — a visual multiplier,
never a `PageLayout` edit — so it must not and does not enter this
history (see [app-resize.md](./app-resize.md)).

## Reconciliation

After every workspace change the active page's history is reconciled: a
semantically identical layout with a fresh reference (server ack,
IndexedDB round-trip) only rebases `present` — past and future survive.
A semantically different layout (add/delete app, folder move/dissolve,
remote pull) resets that page's history, so undo can never resurrect a
dangling layout item.

## Local-first

Group drags, nudges, undo and redo all follow the same contract as every
other edit: pure operation → local stage → UI → explicit sync attempt.
Offline the UI changes immediately and the workspace goes
dirty/Pending-Offline; conflicts keep local editing fully available.
Opening or closing the global launcher itself never modifies the
arrange selection or history.
