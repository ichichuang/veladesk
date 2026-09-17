# Production Desktop Shell

Task 010 replaced the development placeholder homepage with the first
production VelaDesk surface: a local-first desktop shell with boot,
onboarding, workspace selection, ready desktop, drag & drop, Add App,
launch and sync status.

## Responsibility

Boundaries are unchanged from the existing architecture docs — the shell is
a presentation layer over them:

- `@veladesk/client-runtime` owns the session and data: bootstrap,
  active-workspace state, staging, explicit sync/pull. The shell only reads
  its external store (`useSyncExternalStore`) and calls its methods.
- The desktop shell (`apps/web/features/home/`) owns presentation and user
  gestures: runtime-state screens, grid rendering, mode toggle, dialogs,
  launch.
- `@veladesk/desktop-engine` owns spatial legality: placement, collision,
  `moveItem` nearest-free resolution.
- `@veladesk/desktop-interaction` owns pixel→grid conversion
  (`dragDeltaToDesiredPosition`, `calculateGridPixelMetrics`).

`apps/web/features/workspace-runtime/workspace-runtime-provider.tsx` is a
generic provider: loading and error presentations are caller-supplied
fallbacks (default `null`), open/initialize failures are caught (no
unhandled rejections) and a failed runtime open is dropped from the browser
singleton cache so an explicit retry (reload) gets a fresh attempt.

## Local-first editing

Every user gesture that changes the workspace stages immediately:

1. gesture produces the next `WorkspaceSnapshot` (pure helpers in
   `features/home/workspace-layout.ts`: `replacePageLayout`,
   `addAppToPage` — both immutable, typed failures);
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

The active page is ephemeral session state: it resolves the session choice,
then `preferences.defaultPageId`, then the first page; it is never
persisted in this stage.

## Desktop rendering

The ready shell is a fixed viewport (no body scroll): ambient wallpaper
layer, compact glass top bar (brand, workspace name, sync indicator, Add,
View/Arrange), the page grid, optional page dots, floating bottom dock.

`DesktopGridView` renders `PageLayout` as a CSS grid (`grid-column` /
`grid-row` with spans); each `LayoutItem.id` resolves to its entity:
apps render as OS-like icon + label buttons (generated icon text only in
this stage — no favicon/iconify/asset fetching), folders open their
overlay on a view-mode click, widgets are the only glass-surface
entities, and a layout item whose entity is missing renders a restrained
"Missing item" placeholder. The dock renders `workspace.dock.items` in
stored order — apps launch, folders open the overlay — next to a Create
menu and a mode utility. Page dots and ArrowLeft/ArrowRight switching
(ignored while a drag is live or focus is in a form field) appear only
when a workspace has more than one page.

Since the workspace editing task, entity interaction is rounded out by
context menus (right-click or Shift+F10 on desktop/dock/overlay items,
plus the empty-desktop menu), the folder overlay with Add App into the
folder, dock pin/unpin via the entity menu, and app edit/delete dialogs —
see [workspace-editing.md](./workspace-editing.md).

## Arrange mode

`DesktopMode` is `"view" | "arrange"`, initialized from
`preferences.layoutLocked` but session-only — this stage never writes
preferences. View mode never drags and single-click launches apps;
arrange mode disables launch and enables dragging.

Drag sessions use the shared atomic contract in
`apps/web/features/desktop-grid/use-atomic-grid-drag.ts` (the validated
desktop-lab logic, now reused by both the lab and production): the layout
and pixel metrics captured at drag start are the only commit inputs; dnd-kit
owns the free transform while dragging; the drop converts the delta via
`dragDeltaToDesiredPosition`, resolves nearest-free with engine
`moveItem`, and is dropped on cancel, mid-drag resize, or a changed layout.
Mode controls lock while a drag is live. Grid metrics measurement
(`useGridMetrics`) moved to the same shared `features/desktop-grid/`
module.

## Add App v1

One dialog, two fields (name, URL), stored verbatim: no protocol
rewriting, no `new URL()` parsing — `https://`, `http://` and custom
protocols (`obsidian://`, `steam://`, …) are all valid. Icons are
generated from the name (first two code points, uppercased where
applicable). The app is placed on the active page with nearest-free 1x1
placement (`addAppToPage`), staged, and a follow-up sync is fired; a sync
failure never removes the icon.

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

## Scope

Not in this stage: folder opening or creation, dock pin/unpin/reorder,
settings center, theme studio, global launcher, real icon fetching,
widget implementations, active-workspace persistence, animation engine.
Visual motion is CSS-only with `prefers-reduced-motion` fallbacks.
