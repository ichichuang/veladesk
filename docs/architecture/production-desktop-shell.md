# Production Desktop Shell

Task 010 replaced the development placeholder homepage with the first
production VelaDesk surface: a local-first desktop shell with boot,
onboarding, workspace selection, ready desktop, drag & drop, Add App,
launch and sync status.

Task 015 restructured the ready desktop into a minimal section workspace;
task 017 rebuilt it as a real two-column workspace: a fixed left section
rail (titles only), a right workspace owning the active section's
independent content scrolling, responsive square-grid / freeform placement
modes, a compact Arrange toolbar and Settings V2. The scroll-snap section
stack, the floating nav and the artificial canvas left padding are gone.
See [section-navigation.md](./section-navigation.md) and
[canvas-layout.md](./canvas-layout.md) — this doc keeps the shell-level
view.

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

The active section is EXPLICIT session state in the shell (task 017),
initialized from `preferences.defaultPageId` and reconciled during render
when the active page disappears; nothing is derived from scroll positions.
It is never persisted beyond the preference — see
[section-navigation.md](./section-navigation.md).

## Desktop rendering

The ready shell is a fixed viewport (no body scroll) composed as a real
two-column workspace (task 017): ambient wallpaper layer; a fixed left
section rail (titles only, no footer); a right workspace holding the
compact Arrange-only toolbar band, the one section viewport (exactly the
active section's scroller, plus a brief read-only exiting twin during
transitions) and the quiet global sync status; and a bottom dock that
exists ONLY when entities are pinned. All desktop commands (Add App, New
Section, Search, Arrange toggle, Undo/Redo, Grid/Freeform, Sync/Refresh,
Settings, language) live in the custom context menu, with the primary
Grid/Freeform switch and the gap stepper also in the Arrange toolbar —
there is no top bar and there are no page dots.

`DesktopCanvasView` renders a page's placement in one of two geometries.
Grid pages are a real CSS Grid host: `repeat(columns, minmax(0, 1fr))`
columns, `grid-auto-rows: var(--vd-grid-cell-size)`, `gap:
var(--vd-grid-gap)`, one item per integer `gridColumn`/`gridRow` area,
unbounded rows, `min-height: 100%` on the stage. Freeform pages keep
`.vela-canvas` — one viewport-height stage whose box is the logical
0..10000 canvas, every item absolutely positioned in percent space via
`canvasRectStyle`. In both, each item id resolves to its entity: apps
render as a decorated tile that fills the box with the glyph centered
inside it, folders open their overlay on a view-mode click, widgets are
the only glass-surface entities, and an item whose entity is missing
renders a restrained "Missing item" placeholder. A legacy or v1 page
renders through the same component using the placement derived by
`resolvePagePlacement` (see [canvas-layout.md](./canvas-layout.md)), so
production has exactly ONE renderer per geometry. The dock renders
`workspace.dock.items` in stored order — apps launch, folders open the
overlay, right-click opens the entity menu — and renders `null` (no DOM
shell at all) when nothing is pinned. Section switching is state-based:
rail clicks (plus rail wheel — one section per gesture — and rail
arrows/Home/End), launcher section results; the old global ArrowUp/
ArrowDown paging is gone because the right side owns real scrolling.

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

Drag sessions use `features/canvas/use-canvas-drag.ts`: the placement, the
gesture metrics (freeform: the canvas pixel box; grid: the cell pitch) and
the moving ids captured at drag start are the only commit inputs; dnd-kit
owns the free pointer transform while peers follow the resolved
translation; the drop converts pixels to logical units (freeform) or whole
cells (grid), resolves ONE rigid translation — a grid section rounds the
pointer to cell deltas and clamps the group inside the columns — and is
dropped on cancel, a mid-drag metrics change, or a changed placement. Mode
controls lock while a drag is live. Freeform metrics are measured from the
`.vela-canvas` box (`use-canvas-metrics.ts`); grid metrics from the
`.vela-grid-stage` width through `use-square-grid-metrics.ts` (the scroller
keeps a stable scrollbar gutter, so the width — and therefore the square
cell size — never jitters).

Since the arrange-session task, arrange mode also carries a session-only
selection (click, Cmd/Ctrl toggle, marquee, Cmd/Ctrl+A), rigid group
drags with a transient peer preview, keyboard nudges and a per-page
geometry Undo/Redo (move AND resize) — see
[arrange-session.md](./arrange-session.md).

### Visible square grid (017 / 017-A)

In Arrange + Grid the stage shows the placement grid as ISOLATED SQUARE
SLOTS (`.vela-grid-slots`, task 017-A), not graph paper: one
pointer-transparent SVG whose repeating `userSpaceOnUse` pattern tile
spans a full pitch (`cellPx + gapPx`) and draws exactly ONE stroked
square. The tile's remaining area stays transparent, so the persisted
`gridGapPx` is the literal blank distance between neighbouring slots —
a 2×2 item covers four squares plus the internal gap on each axis. The
overlay starts at the grid content origin, covers the stage (so at least
the visible height and every content row), never participates in layout
and never takes pointers; its `cellPx`/`gapPx` come straight from
`calculateSquareGridMetrics`, the sole geometry source. View mode and
freeform render no grid. Entering arrange fades the slots in with a
140ms opacity-only animation (`vela-guides-in`, disabled under
`prefers-reduced-motion`). The old center-dot snap lattice (016-C) and
the continuous-line background pair (017) are deleted. A lossy
Grid→Freeform conversion (content beyond the freeform viewport) is
refused with a localized reason — the toolbar disables the switch, the
menu shows the reason, geometry is never silently dropped.

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
until the user picks a custom icon. The app is placed on the active page at the next first-free row-major
cell with the default 1×1 span (`addAppToPage`), staged, and a follow-up
sync is fired; a sync failure never removes the icon. Placement never
fails for space — grid rows are unbounded and a freeform page accepts
overlap — and a legacy or v1 page is materialized into v2 placement by
this very first edit. The visual identity (library icon, text, colors, decoration) is
edited afterwards via the context menu — see
[app-visual-system.md](./app-visual-system.md).

## App visual editing (016-A, revised in 016-C)

The app context menu gained 编辑外观… / Edit appearance… between Edit
and the section/dock group. It opens the App Visual Editor, a FIXED SHELL
whose preview header and Cancel/Save footer stay outside the one
scrolling body. The scrolling body has three sections (017-C): §Icon —
the icon source (the paginated self-hosted catalog, or auto/custom text,
or an uploaded image since 016-B) plus the per-app **Icon size** slider
(0.5–2.0, the INNER glyph multiplier); §Title — the per-app **show name**
switch and **Title size** slider; §Appearance — Auto-or-hex
foreground/decoration colors and the four decoration styles. Everything
renders live in a draft preview through the shared AppIconRenderer on a
fixed tile (the preview tile never grows with the draft's icon size).
Tile size and SHAPE remain Arrange-mode geometry — dragging the rect's
handles (see [app-resize.md](./app-resize.md)); the header hint says so in
one line. Only Save stages anything (via `replaceApp`, which preserves
page, folder, dock placement and the current presentation); Cancel never
mutates. Edit App keeps its name/URL/open-mode scope and only recalculates
initials for auto-sourced generated icons.

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
