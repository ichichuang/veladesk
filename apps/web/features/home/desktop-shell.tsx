"use client";

import { DragDropProvider } from "@dnd-kit/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import {
  deleteApp,
  dissolveFolderToPage,
  findDesktopPage,
  moveAppToPage,
  pinEntityToDock,
  unpinEntityFromDock,
} from "@veladesk/domain";
import type {
  AppShortcut,
  DesktopPage,
  DesktopPageId,
  EntityId,
  Folder,
  WorkspaceEntity,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { PageLayout } from "@veladesk/desktop-engine";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useAtomicGridDrag } from "../desktop-grid/use-atomic-grid-drag";
import { useGridMetrics } from "../desktop-grid/use-grid-metrics";
import {
  ContextMenu,
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import type { ContextMenuAction, ContextMenuState } from "./context-menu";
import { AddAppDialog } from "./add-app-dialog";
import type { AddAppDestination } from "./add-app-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { DesktopGridView } from "./desktop-grid";
import { Dock } from "./dock";
import { EditAppDialog } from "./edit-app-dialog";
import { FolderDialog } from "./folder-dialog";
import { FolderOverlay } from "./folder-overlay";import { MoveToFolderDialog, eligibleFoldersForMove } from "./move-to-folder-dialog";
import { SyncIndicator } from "./sync-indicator";
import { replacePageLayout } from "./workspace-layout";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { launchApp } from "./launch-app";
import "./home-shell.css";

/** UI-only desktop mode. Session state — never persisted back to preferences. */
export type DesktopMode = "view" | "arrange";

/** What a context menu was opened on. Presentation-only state, never persisted. */
export type ContextMenuTarget =
  | {
      readonly kind: "entity";
      readonly entityId: EntityId;
      readonly source: "desktop" | "dock" | "folder";
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "desktop";
      readonly x: number;
      readonly y: number;
    };

/** Overlay/dialog surfaces the shell can host, one at a time (plus overlay). */
export type HomeDialog =
  | { readonly kind: "add-app"; readonly destination: AddAppDestination }
  | { readonly kind: "edit-app"; readonly entityId: EntityId }
  | { readonly kind: "delete-app"; readonly entityId: EntityId }
  | { readonly kind: "new-folder" }
  | { readonly kind: "rename-folder"; readonly folderId: EntityId }
  | { readonly kind: "delete-folder"; readonly folderId: EntityId }
  | {
      readonly kind: "move-to-folder";
      readonly appId: EntityId;
      readonly currentFolderId: EntityId | null;
    };

interface DesktopShellProps {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}

/**
 * The ready-state production desktop: fixed viewport, ambient wallpaper,
 * top bar, entity grid, page dots and floating dock.
 *
 * Local-first editing: every edit runs a pure domain operation, stages the
 * resulting snapshot immediately (UI updates without waiting for the
 * network), then fires an explicit sync. Drag sessions are atomic (shared
 * useAtomicGridDrag contract); context menus, dialogs and the folder
 * overlay are presentation-only shell state.
 */
export function DesktopShell({ workspace, lastRemoteResult }: DesktopShellProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const snapshot = workspace.snapshot;

  const [mode, setMode] = useState<DesktopMode>(() =>
    snapshot.preferences.layoutLocked ? "view" : "arrange"
  );
  const [sessionPageId, setSessionPageId] = useState<DesktopPageId | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<HomeDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [overlayFolderId, setOverlayFolderId] = useState<EntityId | null>(null);
  const arrange = mode === "arrange";

  const activePage = resolveActivePage(snapshot, sessionPageId);

  // Latest-value mirrors for async/session callbacks (drag commit, page
  // keyboard navigation) that must always see the current render's data.
  const workspaceRef = useRef(workspace);
  const pageIdRef = useRef<DesktopPageId | null>(activePage?.id ?? null);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  useEffect(() => {
    pageIdRef.current = activePage?.id ?? null;
  }, [activePage]);

  const commitDraggedLayout = useCallback(
    (movedLayout: PageLayout, layoutAtStart: PageLayout) => {
      const current = workspaceRef.current;
      const pageId = pageIdRef.current;
      if (pageId === null) {
        return;
      }
      const page = findDesktopPage(current.snapshot, pageId);
      // The drag session already rejected stale layouts; this re-check pins
      // the commit to the exact workspace state the drag started from.
      if (page === undefined || page.layout !== layoutAtStart) {
        return;
      }
      const replaced = replacePageLayout(current.snapshot, pageId, movedLayout);
      if (!replaced.ok) {
        return;
      }
      void stageWorkspaceAndTrySync(runtime, replaced.workspace);
    },
    [runtime]
  );

  const { gridRef, metrics } = useGridMetrics(
    activePage !== undefined ? activePage.layout.grid : { columns: 1, rows: 1 }
  );
  const { dragging, handleDragStart, handleDragEnd } = useAtomicGridDrag({
    layout: activePage !== undefined ? activePage.layout : null,
    metrics,
    onCommit: commitDraggedLayout,
  });

  function openContextMenu(target: ContextMenuTarget) {
    setContextMenu(buildContextMenuState(target));
  }

  function buildContextMenuState(target: ContextMenuTarget): ContextMenuState {
    if (target.kind === "desktop") {
      return {
        x: target.x,
        y: target.y,
        actions: [
          {
            id: "add-app",
            label: "Add App",
            onSelect: () => openDialog({ kind: "add-app", destination: pageDestination() }),
          },
          {
            id: "new-folder",
            label: "New Folder",
            onSelect: () => openDialog({ kind: "new-folder" }),
          },
          {
            id: "toggle-mode",
            label: arrange ? "Switch to View mode" : "Switch to Arrange mode",
            onSelect: () => setMode(arrange ? "view" : "arrange"),
          },
        ],
      };
    }

    const entity = snapshot.entities.find((candidate) => candidate.id === target.entityId);
    if (entity === undefined) {
      return { x: target.x, y: target.y, actions: [] };
    }
    return {
      x: target.x,
      y: target.y,
      actions: buildEntityMenuActions(entity, target.source, {
        snapshot,
        activePageId: activePage?.id ?? null,
        onOpenApp: (app) => launchApp(app),
        onOpenFolder: (folderId) => setOverlayFolderId(folderId),
        onEditApp: (appId) => openDialog({ kind: "edit-app", entityId: appId }),
        onDeleteApp: (appId) => openDialog({ kind: "delete-app", entityId: appId }),
        onMoveToFolder: (appId, currentFolderId) =>
          openDialog({ kind: "move-to-folder", appId, currentFolderId }),
        onMoveToDesktop: (appId) => void moveToDesktop(appId),
        onPin: (entityId) => void runDockEdit((input) => pinEntityToDock(input, entityId)),
        onUnpin: (entityId) => void runDockEdit((input) => unpinEntityFromDock(input, entityId)),
        onRenameFolder: (folderId) => openDialog({ kind: "rename-folder", folderId }),
        onDeleteFolder: (folderId) => openDialog({ kind: "delete-folder", folderId }),
      }),
    };
  }

  function pageDestination(): AddAppDestination {
    return { kind: "page", pageId: activePage?.id ?? snapshot.pages[0]?.id ?? "page" };
  }

  function openDialog(next: HomeDialog) {
    setDialogError(null);
    setDialog(next);
  }

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

  /**
   * Runs a domain dock edit and stages it. Dock edits have no inline error
   * surface of their own (menu actions) — failures are logged, never
   * silently swallowed into a fake success.
   */
  async function runDockEdit(edit: (snapshot: WorkspaceSnapshot) => ReturnType<typeof pinEntityToDock>) {
    const result = edit(snapshot);
    if (!result.ok) {
      console.error(`VelaDesk: dock edit refused (${result.reason})`);
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      console.error(`VelaDesk: dock edit was not staged (${staged.reason})`);
    }
  }

  async function moveToDesktop(appId: EntityId) {
    const pageId = activePage?.id;
    if (pageId === undefined) {
      return;
    }
    const result = moveAppToPage(snapshot, appId, pageId);
    if (!result.ok) {
      console.error(`VelaDesk: move to desktop refused (${result.reason})`);
      return;
    }
    await stageWorkspaceAndTrySync(runtime, result.workspace);
  }

  async function handleDeleteApp(appId: EntityId) {
    const result = deleteApp(snapshot, appId);
    if (!result.ok) {
      setDialogError("This app no longer exists.");
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setDialogError("The app could not be deleted.");
      return;
    }
    closeDialog();
  }

  async function handleDeleteFolder(folderId: EntityId) {
    const pageId = activePage?.id;
    if (pageId === undefined) {
      setDialogError("There is no active page to move the apps to.");
      return;
    }
    const result = dissolveFolderToPage(snapshot, folderId, pageId);
    if (!result.ok) {
      setDialogError(
        result.reason === "no-space"
          ? "Not enough room on this page to remove the folder."
          : "This folder no longer exists."
      );
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setDialogError("The folder could not be removed.");
      return;
    }
    if (overlayFolderId === folderId) {
      setOverlayFolderId(null);
    }
    closeDialog();
  }

  // Keyboard page switching — never while a drag is live or focus sits in
  // a form field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (dragging || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) {
        return;
      }
      const pages = workspaceRef.current.snapshot.pages;
      if (pages.length < 2) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const currentId = pageIdRef.current;
      const index = pages.findIndex((page) => page.id === currentId);
      if (index < 0) {
        return;
      }
      const nextIndex =
        event.key === "ArrowLeft"
          ? Math.max(0, index - 1)
          : Math.min(pages.length - 1, index + 1);
      if (nextIndex !== index) {
        event.preventDefault();
        setSessionPageId(pages[nextIndex]!.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dragging]);

  if (activePage === undefined) {
    // Invariant violation (a workspace always has pages) — stay calm, stay
    // inspectable, never crash the tab.
    return (
      <main className="vela-screen">
        <div className="vela-screen__ambient" aria-hidden="true" />
        <section className="vela-screen__panel">
          <h1 className="vela-wordmark">VelaDesk</h1>
          <p className="vela-screen__lead">
            This workspace contains no pages, so there is nothing to display.
          </p>
          <button
            type="button"
            className="vela-button"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </section>
      </main>
    );
  }

  const pages = snapshot.pages;
  const overlayFolder =
    overlayFolderId !== null
      ? snapshot.entities.find(
          (entity): entity is Folder => entity.kind === "folder" && entity.id === overlayFolderId
        )
      : undefined;

  function handleTopbarCreate(event: ReactMouseEvent<HTMLButtonElement>) {
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    openContextMenu({
      kind: "desktop",
      x: anchor.x,
      y: anchor.y,
    });
  }

  function handleTopbarCreateKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!isContextMenuKeyEvent(event)) {
      return;
    }
    event.preventDefault();
    const anchor = contextMenuAnchorFromElement(event.currentTarget);
    openContextMenu({ kind: "desktop", x: anchor.x, y: anchor.y });
  }

  return (
    <div className="vela-desktop" data-arrange={arrange ? "true" : "false"}>
      <header className="vela-topbar">
        <span className="vela-topbar__brand">VelaDesk</span>
        <span className="vela-topbar__workspace">{snapshot.name}</span>
        <span className="vela-topbar__spacer" />
        <SyncIndicator workspace={workspace} lastRemoteResult={lastRemoteResult} />
        <button
          type="button"
          className="vela-button vela-topbar__add"
          aria-haspopup="menu"
          onClick={handleTopbarCreate}
          onKeyDown={handleTopbarCreateKeyDown}
        >
          Add
        </button>
        <div className="vela-segment" role="group" aria-label="Desktop mode">
          <button
            type="button"
            className="vela-segment__button"
            aria-pressed={!arrange}
            disabled={dragging}
            onClick={() => setMode("view")}
          >
            View
          </button>
          <button
            type="button"
            className="vela-segment__button"
            aria-pressed={arrange}
            disabled={dragging}
            onClick={() => setMode("arrange")}
          >
            Arrange
          </button>
        </div>
      </header>

      <DragDropProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div
          className="vela-desktop__menu-area"
          onContextMenu={(event) => {
            // Only reached when no entity handled the event (entities stop
            // propagation).
            event.preventDefault();
            openContextMenu({ kind: "desktop", x: event.clientX, y: event.clientY });
          }}
        >          <DesktopGridView
            layout={activePage.layout}
            workspace={snapshot}
            arrange={arrange}
            metrics={metrics}
            gridRef={gridRef}
            onEntityContextMenu={(entityId, x, y) =>
              openContextMenu({ kind: "entity", entityId, source: "desktop", x, y })
            }
            onOpenFolder={(folderId) => setOverlayFolderId(folderId)}
          />
        </div>
      </DragDropProvider>

      {pages.length > 1 ? (
        <div className="vela-pages" role="group" aria-label="Pages">
          {pages.map((page) => (
            <button
              key={page.id}
              type="button"
              className="vela-pages__dot"
              data-active={page.id === activePage.id ? "true" : undefined}
              aria-label={page.name}
              title={page.name}
              disabled={dragging}
              onClick={() => setSessionPageId(page.id)}
            />
          ))}
        </div>
      ) : null}

      <Dock
        workspace={snapshot}
        arrange={arrange}
        dragging={dragging}
        onToggleMode={() => setMode(arrange ? "view" : "arrange")}
        onCreateMenu={(x, y) => openContextMenu({ kind: "desktop", x, y })}
        onOpenFolder={(folderId) => setOverlayFolderId(folderId)}
        onEntityContextMenu={(entityId, x, y) =>
          openContextMenu({ kind: "entity", entityId, source: "dock", x, y })
        }
      />

      {overlayFolder !== undefined ? (
        <FolderOverlay
          folder={overlayFolder}
          workspace={snapshot}
          onClose={() => setOverlayFolderId(null)}
          onAddApp={() =>
            openDialog({
              kind: "add-app",
              destination: { kind: "folder", folderId: overlayFolder.id },
            })
          }
          onLaunchApp={launchApp}
          onChildContextMenu={(entityId, x, y) =>
            openContextMenu({ kind: "entity", entityId, source: "folder", x, y })
          }
        />
      ) : null}

      {dialog !== null && dialog.kind === "add-app" ? (
        <AddAppDialog
          workspace={snapshot}
          destination={dialog.destination}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "edit-app" ? (
        <EditAppDialog
          workspace={snapshot}
          appId={dialog.entityId}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "delete-app" ? (
        <DeleteAppConfirm
          workspace={snapshot}
          appId={dialog.entityId}
          error={dialogError}
          onConfirm={() => void handleDeleteApp(dialog.entityId)}
          onCancel={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "new-folder" ? (
        <FolderDialog
          workspace={snapshot}
          pageId={activePage.id}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "rename-folder" ? (
        <FolderDialog
          workspace={snapshot}
          pageId={activePage.id}
          folder={findFolderEntity(snapshot, dialog.folderId)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "move-to-folder" ? (
        <MoveToFolderDialog
          workspace={snapshot}
          appId={dialog.appId}
          currentFolderId={dialog.currentFolderId}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "delete-folder" ? (
        <ConfirmDialog
          title="Delete folder?"
          message="Apps inside will be returned to the current desktop."
          confirmLabel="Delete folder"
          error={dialogError}
          onConfirm={() => void handleDeleteFolder(dialog.folderId)}
          onCancel={closeDialog}
        />
      ) : null}

      {contextMenu !== null ? (
        <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      ) : null}
    </div>
  );
}

function findFolderEntity(
  workspace: WorkspaceSnapshot,
  folderId: EntityId
): Folder | undefined {
  const entity = workspace.entities.find((candidate) => candidate.id === folderId);
  return entity !== undefined && entity.kind === "folder" ? entity : undefined;
}

function DeleteAppConfirm({
  workspace,
  appId,
  error,
  onConfirm,
  onCancel,
}: {
  workspace: WorkspaceSnapshot;
  appId: EntityId;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const app = workspace.entities.find(
    (entity): entity is AppShortcut => entity.kind === "app" && entity.id === appId
  );
  return (
    <ConfirmDialog
      title={`Delete ${app?.name ?? "app"}?`}
      message="The app and every reference to it (pages, folders, dock) will be removed."
      confirmLabel="Delete app"
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

interface EntityMenuCallbacks {
  readonly snapshot: WorkspaceSnapshot;
  readonly activePageId: DesktopPageId | null;
  readonly onOpenApp: (app: AppShortcut) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  readonly onEditApp: (appId: EntityId) => void;
  readonly onDeleteApp: (appId: EntityId) => void;
  readonly onMoveToFolder: (appId: EntityId, currentFolderId: EntityId | null) => void;
  readonly onMoveToDesktop: (appId: EntityId) => void;
  readonly onPin: (entityId: EntityId) => void;
  readonly onUnpin: (entityId: EntityId) => void;
  readonly onRenameFolder: (folderId: EntityId) => void;
  readonly onDeleteFolder: (folderId: EntityId) => void;
}

/**
 * Builds the context-menu actions for one entity.
 *
 * Apps: Open / Edit / Move to Folder… / pin toggle / Delete (+ Move to
 * Desktop inside folders). Folders: Open / Rename / pin toggle / Delete.
 * Open always works in both modes; Move to Folder lists reachable folders
 * only (placed or dock-pinned, excluding the current one).
 */
function buildEntityMenuActions(
  entity: WorkspaceEntity,
  source: "desktop" | "dock" | "folder",
  callbacks: EntityMenuCallbacks
): readonly ContextMenuAction[] {
  const { snapshot } = callbacks;
  const pinned = snapshot.dock.items.includes(entity.id);
  const pinAction: ContextMenuAction = pinned
    ? { id: "unpin", label: "Remove from Dock", onSelect: () => callbacks.onUnpin(entity.id) }
    : { id: "pin", label: "Pin to Dock", onSelect: () => callbacks.onPin(entity.id) };

  if (entity.kind === "app") {
    const eligible = eligibleFoldersForMove(snapshot, source === "folder" ? containerFolderId(snapshot, entity.id) : null);
    const actions: ContextMenuAction[] = [
      { id: "open", label: "Open", onSelect: () => callbacks.onOpenApp(entity) },
      { id: "edit", label: "Edit", onSelect: () => callbacks.onEditApp(entity.id) },
    ];
    if (source === "folder") {
      actions.push({
        id: "move-to-desktop",
        label: "Move to Desktop",
        disabled: callbacks.activePageId === null,
        onSelect: () => callbacks.onMoveToDesktop(entity.id),
      });
    }
    actions.push({
      id: "move-to-folder",
      label: "Move to Folder…",
      disabled: eligible.length === 0,
      onSelect: () =>
        callbacks.onMoveToFolder(
          entity.id,
          source === "folder" ? containerFolderId(snapshot, entity.id) : null
        ),
    });
    actions.push(pinAction);
    actions.push({
      id: "delete",
      label: "Delete",
      onSelect: () => callbacks.onDeleteApp(entity.id),
    });
    return actions;
  }

  if (entity.kind === "folder") {
    return [
      { id: "open", label: "Open", onSelect: () => callbacks.onOpenFolder(entity.id) },
      { id: "rename", label: "Rename", onSelect: () => callbacks.onRenameFolder(entity.id) },
      pinAction,
      {
        id: "delete-folder",
        label: "Delete Folder",
        onSelect: () => callbacks.onDeleteFolder(entity.id),
      },
    ];
  }

  // Widgets are not editable in this stage — no menu actions.
  return [{ id: "widget-later", label: "Widget editing later", disabled: true, onSelect: () => {} }];
}

function containerFolderId(
  workspace: WorkspaceSnapshot,
  appId: EntityId
): EntityId | null {
  const folder = workspace.entities.find(
    (entity): entity is Folder => entity.kind === "folder" && entity.children.includes(appId)
  );
  return folder?.id ?? null;
}

/**
 * The session's active page. Session choice first; otherwise the workspace
 * default; otherwise the first page. `undefined` means the workspace holds
 * no pages at all (invariant violation — rendered as a calm recovery state).
 */
function resolveActivePage(
  workspace: WorkspaceSnapshot,
  sessionPageId: DesktopPageId | null
): DesktopPage | undefined {
  const session =
    sessionPageId !== null ? findDesktopPage(workspace, sessionPageId) : undefined;
  if (session !== undefined) {
    return session;
  }
  return (
    findDesktopPage(workspace, workspace.preferences.defaultPageId) ?? workspace.pages[0]
  );
}
