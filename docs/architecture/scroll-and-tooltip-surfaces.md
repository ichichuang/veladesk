# Scroll surfaces, tooltips and launcher presentation (Task 021-A/B)

The source-level audit and canonical-ownership contract for the unified
scroll surface, the Launcher redesign and the Dock tooltips.

## Canonical components

| Concern | Component | Attribute | Styling |
| --- | --- | --- | --- |
| Scroll surface | `components/vd/scroll-area.tsx` → `VdScrollArea` | `data-vd-scroll="y\|x\|both"` | `app/vd-ui.css` `[data-vd-ui] [data-vd-scroll]` |
| Tooltip | `components/vd/tooltip.tsx` → `VdTooltip` (+ `VdTooltipProvider`) | `data-vd-tooltip` | Tailwind `--vdu-*` classes + `vd-ui.css` motion |

The superseded Task 018 Radix wrappers `components/ui/scroll-area.tsx` and
`components/ui/tooltip.tsx` were unused and are deleted — one canonical path
per primitive.

## Scrollbar visual contract (vd-ui.css)

- Idle: transparent track, fully-rounded thumb in muted foreground at low
  alpha (`color-mix` over `--vdu-fg-muted`), ~4px painted width on the
  WebKit path (10px hit area), UA-thin on the standard
  `scrollbar-width/color` path (Firefox, current Chrome).
- Hover/active: alpha strengthens; the WebKit painted thumb widens slightly
  (border padding 3px → 2px → 1px). Never bright white, never the system
  slab, no scrollbar buttons/arrows.
- `scrollbar-gutter: stable` on vertical surfaces only: a scrollbar becoming
  possible never resizes Settings/Launcher/list content.
- No global wildcard scrollbar styling (`*::-webkit-scrollbar` is forbidden);
  only opted-in `[data-vd-scroll]` surfaces are styled. Keyboard, wheel and
  touch scrolling stay fully native — no scroll-event React state, no
  ResizeObserver, no custom drag scrollbars anywhere.

## Surface inventory (audit of 2026-09-24)

| Surface | Scroll owner before | Owner now | Notes |
| --- | --- | --- | --- |
| Settings Center content pane | bare `overflow-y-auto` div (`data-scrollbar="thin"` had **no CSS anywhere**) | `VdScrollArea` | stable gutter; `data-vd-wheel-scope="local"` kept |
| App Appearance Inspector body | bare `overflow-y-auto` div | `VdScrollArea` | |
| Inspector focused-picker bodies (upload/text) | bare `overflow-y-auto` divs | `VdScrollArea` | |
| Icon Picker results grid | `.vela-icon-picker__grid` raw overflow | `VdScrollArea` (`.vela-icon-picker__scroll`) | framed well moved to the owner |
| Launcher results | `.vela-launcher__results` raw overflow | `VdScrollArea` (`.vela-launcher__results-scroll`) | only the results scroll; header/footer fixed |
| Folder overlay grid | `.vela-folder-overlay__grid` raw overflow | `VdScrollArea` (`.vela-folder-overlay__scroll`) | |
| Move-to-Section dialog body | bare `overflow-y-auto` div | `VdScrollArea` | dead `.vela-move-section__list` CSS deleted |
| Section rail inner title list | `.vela-rail__list` (scrollbar fully hidden) | bare `data-vd-scroll="y"` on the list | **exception (§10)**: no `VdScrollArea`, no wheel scope — the full-rail non-passive wheel listener keeps owning navigation (019/020); the list only receives the quiet scrollbar |
| Right-side section scroller | `.vela-section-scroller` | unchanged | already token-quiet thin with stable gutter (017); part of the frozen 019/020 transition architecture — deliberately not migrated |
| Dock (horizontal) | `.vela-dock` raw `overflow-x: auto` | `data-vd-scroll="x"` on the nav | |
| Desktop context menu | `.vela-context-menu` (scrollbar hidden) | unchanged | menus stay chromeless; keyboard navigation is the primary path |
| `/lab` workspace-runtime page | lab CSS | unchanged | dev-only surface, not a product surface |
| Desktop root / body | — | unchanged | never a scroll surface through this layer |

## Launcher redesign (021-B)

- Search/ranking modules untouched (`launcher-search.ts`,
  `launcher-navigation.ts`, `launcher-index.ts`).
- New pure module `launcher-groups.ts`: presentation-only grouping of the
  ranked list into Commands → Apps → Folders → Sections. Within a group the
  ranking order is preserved; the flat concatenation of groups is the
  keyboard index space (visual order = arrow order).
- Group headings render only when the group has results (`role="group"`
  + `aria-labelledby`).
- Rows: shared leading identity, main label, quiet right-aligned type
  metadata (small muted text — the old bordered capsule badge is gone).
  App rows render through the SHARED icon renderer
  (`AppIconGlyph` + `appIconDecorationProps` at a compact
  `--vd-slot-icon-size: 26px`); commands/sections/folders get quiet Lucide
  symbols. Technical ids never appear.
- Selected row: surface fill + quiet 2px accent bar + stronger text — no
  saturated slab.
- Motion: 260ms popover token (opacity + 6px rise + scale 0.985→1); reduced
  motion renders instantly.
- Activation semantics preserved: Enter activates, Escape/Ctrl-Cmd-K closes,
  hover moves selection, selection scrolls into view with `block:"nearest"`.

## Dock tooltips (021-C)

- Every dock button (apps and legacy folders) is wrapped in `VdTooltip`;
  content is the entity's own name — nothing else (no URL, no ids).
- One `VdTooltipProvider` wraps the dock (open delay 220ms, skip delay
  120ms) so moving between icons re-opens immediately without flicker.
- Radix semantics give hover AND keyboard-focus display; the accessible
  name stays the localized open-label, so the tooltip is supplemental and
  no desktop label preference (`labelVisible`) can suppress it.
- Content is portalled to the shared themed portal root — the tooltip never
  enters dock layout flow, cannot change dock width/spacing, and cannot
  create scrollbars or move the Grid.

## Tests

- `launcher-groups.test.ts` — pure grouping/flatten contracts.
- `launcher-ui.test.ts` — launcher source contracts (structure, shared icon
  path, quiet metadata, keyboard-addressable selection).
- `dock.test.ts` — tooltip coverage, `entity.name` content, no native
  `title`, no `labelVisible` dependency, portal (no layout flow).
- `scroll-surface-contract.test.ts` — canonical component emits
  `data-vd-scroll`; every migrated surface uses it; no wildcard scrollbar
  CSS; desktop root not a scroller; no `onScroll` React state; rail wheel
  ownership intact; superseded `components/ui` primitives deleted.
