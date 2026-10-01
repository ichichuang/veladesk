# Mobile Companion Shell

## Responsibility

Task 026 makes VelaDesk genuinely usable in a phone browser. The product
splits into two modes over ONE workspace:

> **VelaDesk desktop is the authoring environment.**
> **VelaDesk mobile is a companion launcher and consumption interface.**
>
> Both share workspace data, persistence, synchronization, applications,
> categories, Dock membership, wallpapers and user preferences. Mobile does
> not expose desktop layout authoring, resize, drag organization or
> advanced workspace configuration.

Mobile ≠ scaled Desktop. Mobile does not author desktop layout. Desktop
remains the canonical authoring environment.

| Capability | Desktop | Mobile |
| --- | --- | --- |
| Browse sections / open apps / search / folders | ✓ | ✓ |
| Dock (pinned favorites) | ✓ | ✓ (bottom bar) |
| Section & workspace wallpaper, theme | ✓ | ✓ (view only) |
| Language / version | ✓ | ✓ |
| Arrange / drag / resize / marquee / Grid–Freeform | ✓ | — (never rendered) |
| Add / edit / delete apps, sections, folders | ✓ | — |
| Context menus, App Inspector, visual editor | ✓ | — |
| Dock editing (pin/unpin) | ✓ | — |
| Settings Center (880×680) | ✓ | — |
| JSON Import, wallpaper upload, advanced settings | ✓ | — |

## Architecture

```
                 Workspace Runtime          (provider — above every shell)
                       |
         +-------------+-------------+
         |  ResponsiveWorkspaceShell |   (resolver + shared active section)
         |                           |
   DesktopShell               MobileShell     (lazy chunks — one at a time)
   authoring / config         browse / search / open
   resize / import            folder / dock / launch
         |                           |
         +-------------+-------------+
                       |
                SAME WORKSPACE DATA  (snapshot · sync · view-state)
```

- **Exactly one interaction shell mounts** at any moment. Never one shell
  wrapping the other, never both with CSS hiding (duplicate DnD sensors,
  listeners and runtime consumers are the failure mode that forbids it).
- **The runtime provider sits above the shell switch** — a desktop↔mobile
  swap never re-opens the workspace, re-creates the IndexedDB runtime,
  re-fetches the server workspace or re-runs bootstrap. `ResponsiveWorkspaceShell`
  re-mounts wholesale only when the workspace *id* changes.
- **Both shells are lazy chunks** behind the resolver; only the resolved
  shell's code downloads and executes. The existing startup screen covers
  the chunk load.

## Shell mode resolver

`features/home/responsive-shell-mode.ts` — pure decision table;
`use-workspace-shell-mode.ts` — the live hook.

Canonical media query (capability only — **no UA sniffing**):

```
(max-width: 767px),
(max-width: 1024px) and (hover: none) and (pointer: coarse)
```

| Viewport | Mode |
| --- | --- |
| ≤ 767px (any pointer) — phones portrait, narrow desktop windows | mobile |
| 768–1024px + `hover: none` + `pointer: coarse` — touch tablets, phone landscape | mobile |
| > 767px with a fine primary pointer | desktop |

`any-pointer: coarse` is deliberately NOT used: a laptop with a secondary
touchscreen keeps the desktop shell. A phone rotated to landscape stays
mobile through the coarse/no-hover leg. The mode is fully derived from the
current match and **never persisted** (no workspace field, no localStorage,
no view-state entry).

**Hydration**: the ready workspace UI only mounts client-side (the server
render is the startup fallback behind the runtime provider), so the hook
resolves on its first render in a real browser — the first meaningful frame
is already the correct shell; no desktop flash on a phone. If capability is
unresolved (`matchMedia` unavailable), the existing startup surface stays
and neither shell mounts.

## Shared active section (continuity)

`workspace-active-section.ts` — the minimal controller lifted out of
DesktopShell (task 023-A's owner), mounted in `ResponsiveWorkspaceShell`
ABOVE the shell switch:

- `activePageId` / `effectiveActivePageId` (structural fallback: default → first)
- `requestActiveSection(pageId)` — the one navigation entry point; flips
  state AND records the logical destination into the 023-A view-state
  controller (localStorage `veladesk:view-state:v1:<wsId>`, coalesced disk)
- `recordScrollTop(pageId, top)` — desktop section scroll persistence
- one controller per workspace, flushed synchronously on `pagehide` and
  unmount, with the caller's DOM scroll capture invoked before every flush

Desktop selects AI → resize to mobile → AI tab selected. Mobile picks 办公
→ widen → desktop rail on 办公. No default-section flash, because the state
lives above the swap and is never re-read from disk mid-session.
DesktopShell accepts this value as an optional `activeSection` prop;
rendered standalone (tests), it owns the section itself through the same
hook — the pre-026 behavior, byte for byte.

## Mobile presentation

Layout: themed root → shared wallpaper layers → header → category tabs →
natively scrolling content → pinned dock, plus a themed portal sibling for
sheets.

| Surface | Behavior |
| --- | --- |
| **Header** (`mobile-header.tsx`) | Workspace name (one truncated line), quiet sync whisper (clean renders nothing; text + dot, never color alone, not interactive), Search + Menu buttons. 56px + `env(safe-area-inset-top)`. |
| **Category tabs** (`mobile-category-tabs.tsx`) | The rail as a horizontal `role=tablist`; tap switches; the strip scrolls naturally; the active tab is kept visible by a direct `scrollLeft` write (never native smooth scrolling); the shared `VdAnimatedIndicator` pill glides (first placement is a `gsap.set` — a restored section never sweeps). |
| **Section content** | One short entrance per switch — x 12px + fade, `tabContent` band 0.26s, GSAP; reduced motion settles instantly. No desktop transition machine, no outgoing page stack, no swipe gestures (v1 — they collide with browser back, tab scrolling and content scrolling). |
| **App grid** (`mobile-section-items.ts`, `mobile-app-grid.tsx`) | Derived, regular CSS grid — never desktop geometry, never persisted, no `mobileX/mobileY` schema fields. Columns: 4 (≤479px) / 5 (480–767px) / 6 (≥768px incl. tablet & landscape). Items: `resolveMobileSectionItems` orders by the desktop's visual reading order (grid: row→column→id; freeform: y→x→id), keeps apps + folders, quietly skips widgets (desktop-only presentation in v1 — skipped, never deleted). |
| **Tiles** | Icon (shared `AppIconTile`, 52–54px slot) + **always-visible name** — `labelVisible`/`iconScale` desktop preferences are deliberately ignored: a launcher identifies apps by name. Tap = open, through the canonical `launchApp` helper. |
| **Folder sheet** (`mobile-folder-sheet.tsx`) | Bottom sheet (`min(82dvh, 640px)`), Radix Dialog semantics + GSAP surface, normal interface background (never the wallpaper). Consumption only: open apps. No move/delete/rename/dissolve/drag. Close returns focus to the folder tile. |
| **Search** (`mobile-search.tsx`) | Fullscreen surface; 16px input (no iOS auto-zoom); rows ≥52px with icon + name + kind. The model is the desktop launcher's, shared verbatim: `buildLauncherEntries` with `includeCommands: false` (management commands never appear — not disabled, absent) + `searchLauncherEntries` ranking + `moveLauncherIndex` keyboard semantics. App → launch · Folder → sheet · Section → switch. |
| **Dock** (`mobile-dock.tsx`) | Same `workspace.dock.items` as the desktop — membership shared, presentation different. Pinned bottom bar, icon-only buttons with `aria-label` (no hover → no tooltips), horizontal scroll on overflow (never truncation), bottom safe area respected, empty dock renders no bar at all. |
| **Menu** (`mobile-menu-sheet.tsx`) | Deliberately tiny: current workspace, language (中文/English — browser-local, never dirties the workspace), version (`VELADESK_VERSION`), and the desktop-management hint. Workspace switching is omitted in v1 (no clean ready-state switch action exists; nothing was invented for it). |
| **Wallpaper** | The shared resolver (`resolveEffectiveWallpaper`) + the shared `WorkspaceWallpaperLayers` (renamed from DesktopWallpaperLayers; two-slot 0.24s GSAP crossfade) + the shared asset URL path. View-only: no upload/replace/fit/remove. |

## Non-goals (v1)

Mobile app authoring, drag/resize/arrange, section management, dock
editing, JSON Import, wallpaper editing, advanced settings, long-press
menus, swipe navigation, PWA (service worker/install/offline), and any
second search engine or animation system. GSAP remains the only motion
owner; HeroUI/Radix remain the component system.

## Visual polish & presentation rules (026-R1)

The 1.0.0 readability pass — presentation only, no architecture change:

- **Active category**: exactly ONE marker — the shared `VdAnimatedIndicator`
  accent pill (18% wash, 999px radius). The tablist itself is the marker's
  positioned container (`position: relative`): `VdAnimatedIndicator` only
  places a marker whose `offsetParent` IS its container, so without that
  rule the pill never appears (the original "active state too weak" was in
  fact "indicator never rendered"). Text hierarchy: active = `--vd-text` at
  weight 650; inactive = `--vd-text` at a 70% `color-mix` (readable
  navigation, never a disabled token).
- **Typography tiers**: workspace title / active category (`--vd-text`,
  17px/650) → app names + sheet titles (14px/18px, `--vd-text`, two-line
  `-webkit-line-clamp` block with a uniform 36px label height so short and
  long names keep one grid rhythm) → inactive categories and quiet
  metadata → the desktop-management hint (13px/1.45, `--vdu-fg-muted`).
- **Sheet sizing variants**: `MobileSheet` takes `"menu" | "folder" |
  "fullscreen"`. Menu is content-sized (`max-block-size: min(70dvh, 520px)`
  — a four-row menu must not wear the folder's tall slab); folder keeps
  `min(82dvh, 640px)` with internal scroll; the shared bottom HOST only
  positions and never sizes.
- **Sheet readability**: sheet surfaces consume the existing floored
  `--vdu-overlay` token (0.96 alpha floor, dark + light, WCAG-paired with
  `--vdu-fg` by the vd-ui theme contract) — NOT the style-translucent
  `--vdu-window` — so Clean/Soft/Glass all stay readable over the dock and
  wallpaper. One GSAP scrim (`.vela-mobile-sheet__scrim`, black 45% via
  `color-mix`) is the single backdrop owner.
- **Layer order** (contract-pinned): wallpaper/content < dock (z 2) <
  scrim (z 50) < sheet host (z 50, after the scrim in DOM order). The dock
  stays mounted while sheets are open — no layout bounce on close.

## Category transition smoothness (026-R2)

The perceived switch jank was root-caused (source-audited, H1–H7 matrix)
before any repair; four evidence-backed causes were fixed:

- **Prepared-target coordinator** (`mobile/mobile-section-transition.ts`):
  a MINIMAL two-phase machine — idle → preparing(target hidden-mounted) →
  entering (armed one rAF after the hidden mount's layout pass) → idle.
  Previously the ENTIRE incoming grid (all tiles) cold-mounted inside the
  tap's own commit while the entrance started in the same frame; now the
  heavy mount lands on a frame that paints no new content and the entrance
  runs on a settled tree. At most TWO panes exist (visible + one pending,
  `visibility:hidden` + inert — never display:none). Rapid switching is
  latest-target-wins: a superseded preparing page never becomes visible; a
  request during an entrance makes the entering page the visible base.
  Requesting the current section is an exact no-op. The logical
  destination (tabs, wallpaper, view-state persistence) still updates
  IMMEDIATELY at tap time. Reduced motion bypasses straight to the
  settled swap.
- **Horizontal indicator axis** (`VdAnimatedIndicator axis="horizontal"`):
  the mobile pill previously had NO horizontal geometry at all — the
  shared marker only wrote top/height (the rail's model) while the pill's
  CSS width stayed 0, so it never rendered (the R1 fix had only repaired
  the placement precondition). Horizontal mode now measures left/width
  ONCE per placement, MOVES via transform x, and never tweens layout
  properties; the desktop rail keeps the vertical default byte-for-byte.
- **Icon-layer cold-work caches** (`app-icon-renderer.tsx`): library icon
  probe results and uploaded-asset object URLs are cached at the one icon
  layer (the wallpaper layer's established URL pattern — assets are never
  revoked under live surfaces), so a re-shown tile renders synchronously
  with no re-probe, re-fetch or re-decode.
- **Idle search index**: the mobile search model is shared, but the index
  is built only while the surface is open — a category switch with search
  closed no longer rebuilds it.

Wallpaper equality is semantic (config key, not object identity) and
regression-locked: identical effective wallpaper → zero crossfade layers;
different → exactly one two-layer crossfade. Animation ownership is
source-contract locked: panes tween x/opacity only, wallpaper opacity
only, the indicator tween never touches left/top/width/height, and
will-change exists only on the entering pane.

## Responsive & safety rules


- `100dvh` with a `100vh` fallback; safe-area insets on header, dock and
  fullscreen surfaces; horizontal page overflow clipped at the mobile root
  while tabs/dock scroll sideways; `touch-action: manipulation` on targets
  (never a global `none`); native scrolling everywhere (no
  ScrollTrigger/ScrollSmoother/Observer); CSS namespace `vela-mobile-*`
  only — desktop `.vela-*` rules untouched; no second design-token system.
- Mobile read-only invariants, all test-enforced: browsing, searching,
  opening folders/apps and switching shells stage **zero** workspace
  revisions and **zero** syncs; the shared active-section view-state (023-A)
  is the only persistence, and it never enters the workspace.

## Files

| Concern | File |
| --- | --- |
| Mode resolver (pure) + hook | `features/home/responsive-shell-mode.ts`, `use-workspace-shell-mode.ts` |
| Shell switch + code split | `features/home/responsive-workspace-shell.tsx` |
| Shared active section | `features/home/workspace-active-section.ts` |
| Shared system-color probe | `features/home/use-system-prefers-light.ts` |
| Mobile presentation | `features/home/mobile/*` (shell, header, tabs, grid, dock, search, folder sheet, menu, sheet, item resolver, stylesheet) |
| Launcher model extension | `features/home/launcher-index.ts` (`includeCommands`) |
| Wallpaper sharing | `features/home/desktop-wallpaper.tsx` (`WorkspaceWallpaperLayers`) |
