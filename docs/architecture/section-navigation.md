# Section Navigation

Task 015 reframes the production desktop from an OS-like desktop with a
top bar and page dots into a minimal start page of user-defined sections.
A `DesktopPage` is user-facing: UI zh 分区, UI en Section.

## Core model

- **One Section = one viewport.** Every `workspace.pages` entry renders as
  a `<section class="vela-section">` inside one real scroll container
  (`.vela-section-stack`). Each section is exactly one viewport tall
  (`block-size: 100%`, `min-block-size: 100%`) and never scrolls
  internally (`overflow: hidden`) — a full section returns `no-space` and
  the user creates another section or moves apps, instead of scrolling.
- **Real scroll position is the source of truth.** The shell no longer
  commands a session page and then tries to move the scroll position; the
  actual scroll position drives an IntersectionObserver, and
  `activePageId` is its React reflection (see
  `features/home/use-section-navigation.ts`). The observer uses the
  section stack as root and only updates the active state when a section
  clearly dominates (≥ 0.6 visibility) — never per scroll pixel. Changing
  the active section clears the arrange selection.
- **Navigation only scrolls.** Left-nav clicks, keyboard paging, launcher
  section results and post-structure-change reveals all call
  `scrollToSection(pageId)` (instant, never smooth); the observer then
  reflects the new position. No direct active-state writes.

## CSS Scroll Snap

The stack is native-browser territory:

- `.vela-section-stack`: `position: absolute; inset: 0;
  overflow-y: auto; overflow-x: hidden; scroll-snap-type: y mandatory;
  overscroll-behavior-y: contain`; visually hidden scrollbar
  (`scrollbar-width: none` + WebKit `display: none`).
- `.vela-section`: `scroll-snap-align: start; scroll-snap-stop: always` —
  a fast trackpad fling may not skip past intermediate sections.
- There is **no JS wheel physics anywhere**: no wheel listeners, no
  `preventDefault` pager, no delta accumulators, no inertia simulation.
  Wheel, trackpad inertia, mouse semantics and accessibility behavior are
  the browser's own. Static contract tests
  (`features/home/section-scroll-css.test.ts`) pin all of this.
- While a modal surface or a drag is live (dragging, drop handoff,
  Settings, launcher, dialog, context menu, folder overlay) the stack
  carries `data-scroll-locked="true"` and CSS freezes it with
  `overflow-y: hidden` — without changing the scroll position.

## Boot and structure changes

- The first ready layout jumps instantly (never smooth) to
  `preferences.defaultPageId`, else the first page.
- After a reorder the next commit scrolls instantly back to the SAME
  section, so the user never sees a neighbor flash by; after deleting the
  active section the scroll lands on the surviving neighbor
  (`resolveSectionAfterDelete`: next at the deleted position, else
  previous). Keyboard paging (ArrowUp/PageUp previous, ArrowDown/PageDown
  next) never wraps and yields to input fields, modal surfaces and the
  arrange selection.

## Wheel ownership

- **Main section stack**: native paging only.
- **Section content (app canvas)**: never scrolls vertically; wheel over
  an app bubbles naturally to the stack, so wheel-on-app also pages.
- **Local scroll surfaces** carry `data-vd-wheel-scope="local"`:
  Settings content, launcher results, context menus, the legacy folder
  overlay grid, the section-nav list and the move-to-section list. They
  scroll only themselves (`overflow-y: auto` + contained overscroll).
- **Left nav, dock and modal overlays are siblings** of the stack — wheel
  input over them can never page the desktop.

## Left section navigation

`features/home/section-navigation.tsx` is a lightweight projection of
`workspace.pages` floating on the wallpaper — deliberately not a sidebar
panel: no card, no heavy background; muted text items, an accent marker
and brighter text for the active item (`aria-current="page"` only there),
ellipsis for long names, user data never translated. The list scrolls
locally when sections overflow. Right-click / Shift+F10 on an item opens
the section menu (rename, set default unless default, move up/down within
boundaries, delete when empty); a quiet ⋯ footer button opens the same
desktop command menu as the empty-area right-click — the discoverability
fallback. Sync state appears in the nav footer only when it is not clean
(dirty/offline clickable to sync, conflict display-only).

## Folder policy

Folders are legacy-compatible only: existing folders keep decoding,
validating, rendering, opening, launching and dock pinning with no
migration and no data deletion, but the primary UI no longer offers
folder creation, move-into-folder, or Add App inside the overlay. The
folder context menu's primary legacy action is 解散到当前分区 (dissolve
into the current section, `dissolveFolderToPage`).

## Context menu as the primary command surface

With the top bar gone, the custom context menu is the main command
surface, built by one pure builder
(`features/home/desktop-command-menu.ts`) shared by the empty-area
right-click and the nav ⋯ button: at most three groups (add/section/
search · arrange toggle + history · remote action + settings + language),
with unavailable actions hidden rather than stacked up disabled. Native
browser menus survive on text fields and
`[data-vd-native-context-menu="true"]`; there is no global suppressor.
