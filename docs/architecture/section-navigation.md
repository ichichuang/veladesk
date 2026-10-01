# Section Navigation

Task 017 rebuilds section navigation around **explicit active-section state**
and **right-side scroll ownership**: the left rail is a pure section
selector, the right side owns the active section's independent content
scrolling, and the old outer `.vela-section-stack` scroll-snap model is
deleted. A `DesktopPage` stays user-facing: UI zh 分区, UI en Section (the
domain name is deliberately not "Category" — `@veladesk/domain` already has
a separate `Category` entity).

## Core model

- **The active section is explicit session state.** `activePageId` lives in
  the desktop shell, initialized from `preferences.defaultPageId` (else the
  first page) and reconciled during render when the active page is deleted
  (default, else first). Nothing is derived from scroll positions; there is
  no IntersectionObserver anywhere.
- **The right workspace renders exactly the active section's scroller.**
  Each mounted `SectionView` (`features/home/section-view.tsx`) owns one
  `.vela-section-scroller`; wheel input there scrolls only that section's
  apps and never changes the section. Grid content grows downward without
  bound and the scroller follows; freeform content is exactly one viewport
  tall.
- **Per-section scroll memory.** Before leaving a section its `scrollTop`
  is remembered in session state (`SectionScrollMemory`); returning restores
  it — clamped into the current range and re-applied until the Grid rows
  reach their square size (the metrics observer reports a layout later).
  It is never persisted into the workspace snapshot, and a transition never
  resets it.
- **Navigation is a state write plus a transition.** Rail clicks, launcher
  section results and rail wheel/keyboard navigation all call
  `switchSection(pageId)`. Structural reveals (create/reorder/delete) switch
  instantly so the viewport never glides past neighbors.

## Section transition

Switching sections plays a whole-page vertical transition (not browser page
scrolling). Re-architected in 020-A2 around a warm-mounted layer model;
repaired and re-grounded in 021-R1:

- **Warm layers (020-A2)**: the active section plus its ±1 neighbors stay
  MOUNTED (hidden but laid out) so a switch animates existing subtrees
  instead of building the destination inside the transition commit. The
  mounted set rotates only when the machine settles.
- **One machine** (`features/home/section-transition-machine.ts`):
  `idle / prepared / transition` — pure state math, no timers, no queues.
  Layer visual phases (`warm / entering / active / exit`) are DERIVED from
  it; there are no independent visibility booleans in the shell, the page
  or the CSS.
- **Painted-page invariants (021-R1)**, derived via
  `paintableSectionIds`: at idle exactly ONE page paints (the settled
  destination, opacity 1, translation 0); during motion at most TWO —
  the incoming participant and its single outgoing partner; hidden warm
  layers are `visibility: hidden`, `inert`, `aria-hidden`, never paint
  and never join a transition merely because they carried an old exit
  flag (interrupting requests collapse older exits; the binding cancels
  their animation in the same commit that starts the newer one).
- **Motion, 400ms on the one product easing**: next section — the current
  page exits upward, the next enters from below; previous — mirrored;
  travel ≈ 16% of the live viewport height. The transform/opacity frames
  are owned by `section-layer-animator.ts` (`createSectionLayerBinding` +
  Motion's imperative driver): a fresh entry's from-pose is written in the
  layout phase (the first painted frame is already the moving pose — no
  rest-pose flash), retargets animate from the CURRENT visual position
  (A→B→A reverses instead of snapping), and completions are
  generation-guarded.
- **Request identity (021-R1)**: every accepted request mints a
  monotonically increasing generation; a completion from a superseded
  animation or generation can never settle, rotate or cancel the newer
  request. Repeated requests for the same effective target are idempotent.
  A cold destination (outside the warm set) mounts hidden first and arms
  one PAINTED frame later (`requestAnimationFrame`-scheduled, supersede
  -safe) — the destination's observers and adaptive layout settle before
  the reveal.
- **Cross-page isolation (021-R1)**: every shell lookup inside the section
  viewport (scroll-save, marquee stage, drag item resolution) is scoped to
  the interactive page's own layer via `section-layer-query.ts` — a warm
  hidden page can never win a selector lookup, overwrite the shared
  measurement refs (they attach to the interactive layer only), restore
  another page's scroll, or register as a drag/collision target
  (`dragEnabled` is gated on the interactive flag).
- Navigation is session-only: switching never writes a workspace revision.
- Structural reveals and `prefers-reduced-motion` switch instantly with no
  transform animation (the reduced-motion path bumps the generation and
  keeps the same visibility invariants).
- The 021-R1/021-R3 navigation diagnostics (trace ring buffer,
  localStorage activation flag, recording window and Settings entry) were
  removed outright in 023-B.2 — no hidden activation path remains. The
  generation guards, completion-order repairs and visibility invariants
  they once observed are covered by the deterministic test suites.

## Two-column composition

```
Desktop
  Workbench (flex row)
    SectionRail            (fixed column, ~200px)
    Workspace (flex 1, column)
      ArrangeToolbar       (Arrange-only, reserved top band)
      SectionViewport      (the active SectionView + transient exit twin)
      GlobalSyncStatus     (quiet corner whisper)
  Dock / overlays / dialogs / menus / launcher / settings
```

The rail takes its own column and application content never flows under it —
the old artificial 186px canvas left padding is gone. The right layout width
is whatever remains after the rail; dock placement never forces the rail to
reserve desktop content space. Narrow screens keep the two-column shape
usable (the rail shrinks, never disappears).

## Left section rail

`features/home/section-rail.tsx` displays **titles only**: each item shows
`page.name` with ellipsis, a title tooltip, an accent marker and
`aria-current="page"` on the active item (roving tabindex — the active item
is the tab stop). There is no footer, no ⋯ command button and no sync
status (sync moved to the quiet global corner). Right-click / Shift+F10 on
a title opens the section menu. The list can scroll just enough to keep the
active title visible (`scrollIntoView({ block: "nearest" })`); users never
freely scroll it.

## Wheel and keyboard ownership

- **Wheel over the rail = previous/next section.** A pure accumulator
  (`features/home/section-wheel-nav.ts`) sums signed `deltaY` until a
  threshold (48px) is crossed: the crossing fires exactly one next/prev
  action and locks; an inactivity reset (~320 ms quiet) releases the lock.
  One intentional gesture — a wheel flick or a high-resolution trackpad
  glide — changes at most one section. The listener is non-passive and
  always `preventDefault()`s: the rail never scrolls natively. No wrapping
  at either end. Navigation stands down while a drag/resize owns the desktop
  or any modal surface is open.
- **Rail keyboard**: with focus inside the rail, ArrowUp/ArrowDown move
  focus, Home/End jump to the ends, Enter/Space activate the focused
  button. The old global ArrowUp/ArrowDown section switching is removed
  from the shell — the right side owns real vertical content scrolling now.
- **Right-side scroller CSS**: `overflow-y: auto`,
  `overscroll-behavior-y: contain`, `scrollbar-gutter: stable` (so a
  appearing/disappearing scrollbar never changes the Grid width or cell
  size), Firefox `scrollbar-width: thin`, a narrow low-contrast WebKit
  scrollbar — never fully hidden. While a modal surface or a drag is live
  the scroller carries `data-scroll-locked="true"` and CSS freezes it with
  `overflow-y: hidden` without changing the scroll position.
- Local overlay surfaces (`data-vd-wheel-scope`) keep owning their own
  wheel scopes.

## Folder policy

Folders are legacy-compatible only: existing folders keep decoding,
validating, rendering, opening, launching and dock pinning with no
migration and no data deletion, but the primary UI no longer offers folder
creation, move-into-folder, or Add App inside the overlay. The folder
context menu's primary legacy action is 解散到当前分区 (dissolve into the
current section, `dissolveFolderToPage` — Grid-aware: children take the
first free cells scanning from the folder shell's cell).

## Context menu as the primary command surface

The custom context menu remains the main command surface (empty-area
right-click and the rail's empty-space right-click), built by one pure
builder (`features/home/desktop-command-menu.ts`): add/section/search ·
arrange toggle + history · Grid/Freeform placement (arrange only, the
lossy Grid→Freeform switch disabled with its localized reason) · remote
action + settings + language. The Arrange toolbar makes the primary
Grid/Freeform and Gap controls discoverable without opening a menu. Native
browser menus survive on text fields and
`[data-vd-native-context-menu="true"]`; there is no global suppressor.
