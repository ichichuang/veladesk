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
scrolling):

- next section: the current page exits upward, the next enters from below;
  previous section: mirrored;
- ~190 ms, opacity combined with `translateY`;
- during the transition both views are mounted (the exiting twin renders
  read-only, pointer-transparent); after it completes only the active view
  remains;
- rapid input stays deterministic: a second switch before the first settles
  swaps instantly instead of stacking exits (exit animations never queue);
- structural reveals and `prefers-reduced-motion` switch instantly with no
  transform animation.

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
