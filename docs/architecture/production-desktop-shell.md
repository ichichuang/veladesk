# Production Desktop Shell

Task 010 replaced the development placeholder homepage with the first
production VelaDesk surface: a local-first desktop shell with boot,
onboarding, workspace selection, ready desktop, drag & drop, Add App,
launch and sync status.

Task 015 restructured the ready desktop into a minimal section
workspace: full-height scroll-snap section stack, floating left section
navigation, an optional pinned-entity dock and the custom context menu as
the primary command surface. The top bar, page dots and dock utilities
are removed. See
[section-navigation.md](./section-navigation.md) — this doc keeps the
shell-level view.

## Responsibility

Boundaries are unchanged from the existing architecture docs — the shell is
a presentation layer over them:

- `@veladesk/client-runtime` owns the session and data: bootstrap,
  active-workspace state, staging, explicit sync/pull. The shell only reads
  its external store (`useSyncExternalStore`) and calls its methods.
- The desktop shell (`apps/web/features/home/`) owns presentation and user
  gestures: runtime-state screens, canvas rendering, mode toggle, dialogs,
  launch.
- `@veladesk/canvas-engine` owns continuous geometry: rect validation,
  translation, resize math, canvas history (see
  [canvas-layout.md](./canvas-layout.md)).
- `@veladesk/desktop-engine` owns the legacy grid model, used by the desktop
  interaction lab (`placement`, collision, `moveItem` nearest-free).
- `@veladesk/desktop-interaction` owns pixel→grid conversion for that lab path
  (`dragDeltaToDesiredPosition`, `calculateGridPixelMetrics`).

`apps/web/features/workspace-runtime/workspace-runtime-provider.tsx` is a
generic provider: loading and error presentations are caller-supplied
fallbacks (default `null`), open/initialize failures are caught (no
unhandled rejections) and a failed runtime open is dropped from the browser
singleton cache so an explicit retry (reload) gets a fresh attempt.

## Local-first editing

Every user gesture that changes the workspace stages immediately:

1. gesture produces the next `WorkspaceSnapshot` (pure domain operations —
   `replacePageCanvas`, `addAppToPage`, … — all immutable, typed failures);
2. `runtime.stageWorkspaceUpdate(...)` updates the local working copy and
   the UI (never waits for the network);
3. an explicit `runtime.syncCurrent()` follows, fire-and-forget.

A network failure never rolls back local UI: the workspace stays dirty, the
indicator shows Pending/Offline, and the next explicit sync retries.
Creation (`stageWorkspaceCreate`) is the same contract at onboarding time —
the desktop is usable before any server round-trip.

## Runtime states

`VelaHome` maps the runtime state onto fullscreen surfaces:

| State                | Surface                                                            |
| -------------------- | ------------------------------------------------------------------ |
| `idle` / `booting`   | Ambient boot screen (wordmark, one line, CSS-only pulse)            |
| `empty`              | First-use onboarding (workspace name only)                          |
| `remote-unavailable` | Calm notice + Retry (reload) + onboarding, so offline users are never blocked |
| `selection-required` | Workspace picker (name, Local/Server source, sync state/revision; per-item in-flight disabling, inline failures) |
| `ready`              | Desktop shell                                                       |

Provider-level failures (IndexedDB open / bootstrap throwing) render a
fullscreen recovery screen with Reload and the error message folded into a
technical-details section. A workspace whose `pages` array is empty (schema
invariant violation) renders a calm invalid-workspace state instead of
crashing.

The active section is a reflection of the REAL scroll position
(IntersectionObserver over the section stack); `preferences.defaultPageId`
only chooses the boot position. It is never persisted beyond the
preference — see [section-navigation.md](./section-navigation.md).

## Desktop rendering

The ready shell is a fixed viewport (no body scroll): ambient wallpaper
layer, a full-height section stack (one `DesktopPage` per snap viewport,
native CSS scroll-snap paging), the floating left section navigation
(page projection, ⋯ command fallback, quiet non-clean sync status), and a
bottom dock that exists ONLY when entities are pinned. All desktop
commands (Add App, New Section, Search, Arrange toggle, Undo/Redo,
Sync/Refresh, Settings, language) live in the custom context menu — there
is no top bar and there are no page dots.

`DesktopCanvasView` renders a page's canvas: `.vela-canvas` is absolutely
positioned on the desktop's usable content box (the four
`--vd-grid-padding-*` variables reserve the section nav, the top/bottom
padding and the dock strip when `data-has-dock` is set), every item is an
absolutely positioned box in percent space via `canvasRectStyle`, and each
`CanvasLayoutItem.id` resolves to its entity: apps render as a decorated tile
that fills the rect with the glyph centered inside it, folders open their
overlay on a view-mode click, widgets are the only glass-surface entities, and
an item whose entity is missing renders a restrained "Missing item"
placeholder. A legacy page renders through the same component using a virtual
canvas derived from its grid (see [canvas-layout.md](./canvas-layout.md)), so
production has exactly ONE renderer. The dock renders
`workspace.dock.items` in stored order — apps launch, folders open the
overlay, right-click opens the entity menu — and renders `null` (no DOM shell
at all) when nothing is pinned. Section switching is real-scroll based:
wheel/trackpad (native snap), left-nav clicks, ArrowUp/PageUp +
ArrowDown/PageDown (no wrap, lowest keyboard priority) and launcher section
results.

Since the workspace editing task, entity interaction is rounded out by
context menus (right-click or Shift+F10 on desktop/dock/overlay items,
plus the empty-desktop menu), the folder overlay with Add App into the
folder, dock pin/unpin via the entity menu, and app edit/delete dialogs —
see [workspace-editing.md](./workspace-editing.md).

## Arrange mode

`DesktopMode` is `"view" | "arrange"`, initialized from
`preferences.layoutLocked` but session-only — this stage never writes
preferences. View mode never drags and single-click launches apps;
arrange mode disables launch and enables dragging and resizing.

Drag sessions use `features/canvas/use-canvas-drag.ts`: the canvas, canvas
pixel metrics and the moving ids captured at drag start are the only commit
inputs; dnd-kit owns the free pointer transform while peers follow the
resolved translation; the drop converts pixels to logical units, resolves ONE
rigid translation (a snap section resolves a single snapped delta from the
group anchor), and is dropped on cancel, a mid-drag canvas resize, or a
changed canvas. Mode controls lock while a drag is live. Canvas metrics are
measured from the `.vela-canvas` box itself
(`features/canvas/use-canvas-metrics.ts`) — no padding arithmetic, because the
element IS the usable content box.

Since the arrange-session task, arrange mode also carries a session-only
selection (click, Cmd/Ctrl toggle, marquee, Cmd/Ctrl+A), rigid group
drags with a transient peer preview, keyboard nudges and a per-page
geometry Undo/Redo (move AND resize) — see
[arrange-session.md](./arrange-session.md).

### Canvas geometry and the snap lattice (016-C)

Placement is percent geometry inside `.vela-canvas`; there is no CSS grid
anywhere in the production renderer. In arrange mode a **snap** section draws a
lattice overlay (`.vela-desktop__lattice` / `.vela-desktop__grid-guide`):
`pointer-events: none`, one zero-size marker per lattice cell at the cell
CENTER, computed from the same edge rounding the snap engine uses — so a
marker can never disagree with where an item actually snaps. A **freeform**
section draws no markers at all: the canvas has no lattice, and dots there
would misdescribe the model. Entering arrange fades the marker layer in with a
140ms opacity-only animation (`vela-guides-in`, disabled under
`prefers-reduced-motion`); the desktop stays the wallpaper, not a field of
empty card slots. The visual contract — borderless/fill-less markers, dot ≤
8px — is pinned by `home-shell-css.test.ts`.

### Drop = snapped and still (014-D)

An arrange drop has zero decorative motion: the hover lift and its easing
are scoped to `.vela-desktop[data-arrange="false"]`, and dnd-kit's
default 250ms drop animation is disabled through the official Feedback
plugin API (`dropAnimation = null`, see `dnd-static-drop.ts`). The
pointer-follow transform during the drag is untouched. Release means the
destination paints and nothing moves afterwards — no lift, no bounce, no
settle.

## UI locale (014-D)

The production UI is bilingual (zh-CN default, en-US switchable) through
the browser-local locale layer in `features/i18n/` — see
[ui-localization.md](./ui-localization.md). The `<html lang>` attribute
starts zh-CN on the server and follows the active locale on the client;
switching languages never stages, syncs or dirties workspace data.

## Global launcher

The ready shell hosts the workspace launcher: `Ctrl/Cmd+K` or the
top-bar Search button opens a modal search surface over the current
workspace (apps, folders, pages, fixed commands) with deterministic
ranking, combobox/listbox keyboard semantics and focus restore. Opening
and closing it never touches selection, arrange history or the
workspace; activation reuses the existing launch/overlay/dialog/sync
flows. See [global-launcher.md](./global-launcher.md).

## Add App v1

One dialog, two fields (name, URL), stored verbatim: no protocol
rewriting, no `new URL()` parsing — `https://`, `http://` and custom
protocols (`obsidian://`, `steam://`, …) are all valid. Icons default to
an auto-generated text icon (`source: "auto"` — first two code points of
the name, uppercased where applicable) that keeps following renames
until the user picks a custom icon. The app is placed on the active page at
the next cascade position with one lattice cell as its default rect
(`addAppToPage`), staged, and a follow-up sync is fired; a sync failure never
removes the icon. Placement never fails for space — a canvas page accepts
overlap — and a legacy page is materialized into canvas geometry by this very
first edit. The visual identity (library icon, text, colors, decoration) is
edited afterwards via the context menu — see
[app-visual-system.md](./app-visual-system.md).

## App visual editing (016-A, revised in 016-C)

The app context menu gained 编辑外观… / Edit appearance… between Edit
and the section/dock group. It opens the App Visual Editor, a FIXED SHELL
whose preview header and Cancel/Save footer stay outside the one
scrolling body: icon source (the paginated self-hosted catalog, or
auto/custom text, or an uploaded image since 016-B), Auto- or-hex
foreground/decoration colors and the four decoration styles, rendered
live in a draft preview through the shared AppIconRenderer. The size
slider is gone — tile size and shape are edited by dragging the rect's handles
in Arrange mode (see [app-resize.md](./app-resize.md)) and the header says so.
Only Save stages anything (via `replaceApp`, which preserves page, folder,
dock placement and the current icon scale); Cancel never mutates. Edit
App keeps its name/URL/open-mode scope and only recalculates initials for
auto-sourced generated icons.

## Arrange tile resize (016-C)

Selecting a single app in Arrange mode adds EIGHT handles to its rect: four
corners that change both axes and four edges that change one axis each.
Dragging writes a transient preview only, commits once at pointerup, and
records one geometry entry in the arrange canvas history. Full design in
[app-resize.md](./app-resize.md).

## Launch

Launch honors `openMode` with URLs opened verbatim:

- `new-tab` / `new-window`: `window.open(url, "_blank", "noopener,noreferrer")`
- `same-tab`: `window.location.assign(url)`
- `popup`: `window.open(url, "_blank", "popup=yes,width=1100,height=760")`

Browsers may ignore window features; that outcome is accepted. Launch
happens on single click and Enter/Space in view mode only — arrange mode
reserves activation for drag/focus. Items are real buttons (or focusable
elements), so keyboard operation is native.

## Sync status

The top-bar indicator maps `syncState` to Synced / Pending / Conflict and
shows Offline while dirty after a network/server failure. Clicking syncs
when dirty and pulls when clean; conflicts are display-only — they are
never re-sent or auto-resolved in this stage, and the desktop stays fully
usable (including local edits) with a conflict present.

## Workspace appearance & Settings Center

Since Task 014 the shell owns the workspace-scoped theme. The resolved
appearance — the Settings live preview while open, otherwise
`resolveWorkspaceAppearance(snapshot.preferences)` — flows through
`buildAppearanceTheme` into CSS custom properties (`--vd-accent-hue`,
`--vd-surface-opacity`, `--vd-surface-strong-opacity`, `--vd-blur`,
`--vd-radius`, `--vd-icon-size`) plus `data-vd-color-mode` /
`data-vd-wallpaper` on the `.vela-desktop` root. Every surface inside the
shell (top bar, dock, dialogs, folder overlay, context menu, launcher,
Settings itself) inherits the theme from that scope; no component reads
appearance individually. Boot/onboarding/picker keep the neutral `:root`
dark theme — the workspace theme applies only after ready.

The Settings Center (`settings-center.tsx`) is a draft + presentation
overlay (role=dialog, Escape/backdrop cancel, opener focus restore): the
Appearance section previews live without staging, the Desktop section
edits the default page (current view is pinned; only the next session
boots into the new default) and the startup View-mode default. Save goes
through `replaceWorkspacePreferences` + `stageWorkspaceAndTrySync`; see
[appearance-settings.md](./appearance-settings.md).

## Scope

Not in this stage: folder opening or creation, dock pin/unpin/reorder,
settings center, theme studio, real icon fetching, widget
implementations, active-workspace persistence, animation engine.
Visual motion is CSS-only with `prefers-reduced-motion` fallbacks.
