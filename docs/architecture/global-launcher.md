# Global Launcher

Task 013 adds the V1 workspace launcher: `Ctrl/Cmd+K` (or the top-bar
Search button) opens a keyboard-first search surface over the current
workspace — apps, folders, pages and a small fixed command set — with
deterministic ranking and immediate activation.

## Responsibility

- `WorkspaceSnapshot` is the source data. Nothing else is searched.
- The launcher index (`apps/web/features/home/launcher-index.ts`) builds
  the deterministic searchable entries (`buildLauncherEntries`).
- The launcher search (`launcher-search.ts`) owns normalization,
  tokenization, scoring and ranking (`searchLauncherEntries`,
  `normalizeLauncherText`).
- The launcher navigation helper (`launcher-navigation.ts`) owns the
  keyboard index transitions (`moveLauncherIndex`).
- The `Launcher` component (`launcher.tsx`) owns only session state
  (query + active index), the combobox/listbox ARIA wiring and focus
  management.
- `DesktopShell` owns orchestration: the open flag, the global shortcut,
  the entry memo and the activation resolver — entries are pure data and
  never carry callbacks.

## Scope

Active workspace only. Indexed: every app (desktop, folder child,
dock-only, unplaced), every folder, every page (user-facing 分区 /
Section — search metadata keeps page/页面 and adds section/分区), and the
fixed command
set (`add-app`, `new-section`, `toggle-mode`, plus exactly one remote
command chosen by sync state). Widgets are not indexed — V1 has no
unified widget activation semantics. No cross-workspace search, no
network/web/browser-history search, no AI search, no recents.

## Search

Query normalization: trim, lowercase, collapse whitespace runs
(`normalizeLauncherText`). The query is tokenized on spaces; every
token must match somewhere in the label or the secondary strings
(AND semantics). No fuzzy matching, no typo correction, no
locale-dependent collation.

## Ranking

Per token the entry's best match is scored with a fixed table —
primary (label): exact 0, prefix 10, word-prefix 20, substring
30 + index; secondary: exact 40, prefix 50, word-prefix 60,
substring 70 + index. The entry's score is the sum of its per-token
best scores; ordering is score ASC, then `baseOrder` ASC. `baseOrder`
is the entry's position in the empty-query order, which makes every
result list fully deterministic.

## Empty query

An empty (or whitespace-only) query returns the entries unranked, in
the discoverability order: commands, dock items (strict dock order),
active-section entities (strict layout order), remaining apps/folders
(strict entity order), sections (strict page order). An entity that is
both docked and placed appears once — entries dedupe by key, first
occurrence wins.

## Actions

Activation is resolved by the shell against the live snapshot:

- app → existing `launchApp` (all open modes, custom protocols verbatim)
- folder → existing folder overlay (legacy compatibility)
- page → `scrollToSection` — the launcher only scrolls the real section
  stack; the active state follows through the IntersectionObserver
- `add-app` → existing Add App dialog on the active section
- `new-section` → section dialog (create) on the active section — the
  `new-folder` command is retired from the launcher (task 015)
- `open-settings` → Settings Center (local command, available in
  clean/dirty/conflict states; closes the launcher, then the shell opens
  Settings — see [appearance-settings.md](./appearance-settings.md))
- `toggle-mode` → existing `switchMode` helper (view ↔ arrange)
- dirty workspace → `Sync Now` (`runtime.syncCurrent()`)
- clean workspace → `Refresh from Server` (`runtime.pullCurrent()`)
- conflict → neither remote command; all local actions stay available

A stale entry (entity deleted while the launcher is open) resolves to
nothing instead of launching a dangling reference; the entries memo
follows the live snapshot, and the active index normalizes to the
shrunken result set.

## Keyboard

`Ctrl/Cmd+K` toggles the launcher (open only when no context menu,
dialog, folder overlay or drag owns the screen; close while open).
Escape closes. ArrowUp/Down wrap, Home/End jump, Enter activates the
active result, and IME composition (`isComposing`) is never intercepted.
Opening autofocuses the query input and records the opener; closing
restores focus to it when it is still connected.

## Offline

All indexing, search and local actions remain local and work fully
offline. A dirty workspace keeps showing Sync Now; a failed sync keeps
the workspace dirty and leaves reporting to the existing sync indicator
— the launcher itself never toasts.

## Conflict

A conflicted workspace hides the remote commands but keeps every local
action (launch, folder, section scroll, Add App, New Section, Settings, mode
toggle): the working copy stays editable.

## Persistence

Query, active result and open state are session-only UI state — never
written to the snapshot, IndexedDB, the server or localStorage.
