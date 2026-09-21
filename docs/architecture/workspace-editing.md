# Workspace Editing

Task 011 adds the first complete management loop over workspace content:
app edit/delete, folder create/open/rename/move/dissolve, dock pin/unpin,
and entity/desktop context menus.

## Responsibility

- `@veladesk/domain` (`src/editing.ts`) owns the immutable editing and
  container operations. Ordinary failures are typed results
  (`WorkspaceEditResult` / `WorkspaceEditFailureReason`), never throws;
  a failed operation leaves the input snapshot completely untouched.
- The web shell (`apps/web/features/home/`) owns gestures and
  presentation: context menus, dialogs, the folder overlay. Every edit is
  `pure domain operation → stageWorkspaceAndTrySync` — staged locally
  first, then one explicit fire-and-forget sync attempt. Network failure
  never rolls UI back; conflicts keep surfacing as `conflict-present`
  (the runtime never re-sends them) while local editing stays available.
- `@veladesk/client-runtime` owns the current session and staging.
- `@veladesk/local-store` owns the durable working copy.
- `@veladesk/sync` owns remote persistence.

## Container model

An entity has at most one **main container**: an item on a page (a canvas
item, or a legacy grid item on a page that has no canvas yet), a folder child,
or nothing (unplaced). The dock is an orthogonal reference
list — pin/unpin never inspects or changes the main container, which is
why a pinned app stays pinned across page→folder and folder→page moves.

## Folder

Folders contain apps only (validated by the domain), never nested
folders. V1 folders are created empty (`folder-must-be-empty` otherwise)
and take the target page's next canvas cascade rect like an app.

## Moving

`moveAppToFolder` is the real container move: the id is stripped from every
page geometry source and all folder children, then appended to the target
folder; the entity keeps its `entities` index and the dock is untouched.
`moveAppToPage` is the reverse for folder/unplaced apps: the app takes the
target page's next canvas cascade rect and folder membership is cleared in the
same edit. Moving into the current folder is `already-in-folder`; moving a
page app is `already-on-page`.
The Move-to-Folder chooser applies a UI-only usability filter: target
folders must be reachable (placed on any page or dock-pinned), so an app
is never moved into an invisible unplaced folder.

## Safe deletion

`deleteApp` removes the entity plus every reference — canvas items, legacy
layout items, folder children, dock pins — so no dangling id can survive.
Deleting a folder is a **dissolve** (`dissolveFolderToPage`): the folder shell
(entity, canvas item, legacy layout item, dock pin) disappears and its
children return to the target page as visible rects, in children order,
cascading from the folder's own rect when it lived on that page. The
operation is atomic and overlap is legal, so a dissolve never fails for lack
of room. Children never become invisible unplaced data.

## Dock

Pin appends to `dock.items`; unpin removes only the reference. Widgets
are rejected (`dock-kind-not-allowed`). Dock order editing is out of
scope in this stage.

## Context menu

Context menus are presentation-only shell state, never persisted. One
primitive (`ContextMenu`, `role="menu"`/`menuitem`, with separator
entries) serves entity menus (desktop, dock and folder-overlay sources),
the section menu (left-nav items) and the desktop command menu — since
task 015 the one primary command surface (Add App / New Section /
Search, arrange toggle + history, remote action / Settings / language),
shared by the empty-area right-click and the left-nav ⋯ button. Opening
works by right-click and by keyboard
(Shift+F10 / ContextMenu key, anchored to the element rect); the menu is
measured then clamped into the viewport (`clampContextMenuPosition`),
focuses its first enabled item, supports Arrow/Home/End cycling and
Escape, and closes on outside clicks. Entity right-clicks stop
propagation so the empty-desktop menu cannot open underneath.

## Sections (Pages as Sections, task 015)

Desktop pages are user-facing sections (zh 分区, en Section). The domain
owns explicit page CRUD: `addPage` (unique id, non-blank name,
`layout.id === page.id`, empty layout, engine-validated grid),
`renamePage` (verbatim name, position untouched), `movePage` (array order
only, boundary-refused), `setDefaultPage` (only `preferences` change,
appearance/layoutLocked preserved) and `deleteEmptyPage` (empty sections
only, last page refused, default re-targets the next page at the deleted
position or the previous one at the end). All failures are typed
`WorkspaceEditFailureReason` values (`duplicate-page-id`,
`invalid-page-name`, `page-layout-id-mismatch`, `page-must-be-empty`,
`invalid-page-layout`, `page-not-empty`, `cannot-delete-last-page`,
`page-order-boundary`) — ordinary edit failures never throw.

Apps move BETWEEN sections with `relocateAppToPage` — unlike the older
folder→desktop `moveAppToPage` (kept, unchanged), it accepts apps from
anywhere: every geometry and folder-child reference is stripped on a working
copy, then the app is appended to the target canvas, preserving its rect SIZE
when it came from another canvas page. The dock is untouched (pins survive),
the entity array keeps every entry, and `already-on-page` returns the input
completely unchanged — the move itself cannot fail for space. The web shell
exposes this as the 移到分区… / Move to Section… dialog.

## Folder legacy policy

Folders remain fully valid workspace data — decode, validate, render,
open, launch, rename, pin and dissolve all keep working, with no
migration and no deletion. What changed in task 015 is reachability: the
primary UI no longer offers folder creation, move-into-folder, or
Add-App-inside-folder; the folder context menu's primary legacy action is
dissolving into the current section (`dissolveFolderToPage`, unchanged
and atomic).

## Local-first editing

Every operation — app edit, delete, folder create/rename/move/dissolve,
pin/unpin — follows the same contract: run the pure domain operation,
stage the resulting snapshot (UI updates immediately), then attempt one
explicit sync. Server-down editing keeps the workspace dirty with a
Pending/Offline indicator; the next explicit sync (indicator click)
reconciles once the server returns.
