"use client";

import { DragDropProvider } from "@dnd-kit/react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  commitLayout,
  createLayoutHistory,
  moveItems,
  redoLayout,
  undoLayout,
} from "@veladesk/desktop-engine";
import type { LayoutItemId, PageLayout } from "@veladesk/desktop-engine";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { useAtomicGridDrag } from "../desktop-grid/use-atomic-grid-drag";
import { useGridMetrics } from "../desktop-grid/use-grid-metrics";
import { resolveDragItemIds } from "../desktop-grid/group-drag";
import {
  ContextMenu,
  contextMenuAnchorFromElement,
  isContextMenuKeyEvent,
} from "./context-menu";
import type { ContextMenuAction, ContextMenuState } from "./context-menu";
import { AddAppDialog } from "./add-app-dialog";
import type { AddAppDestination } from "./add-app-dialog";
import { canRedo, canUndo, reconcilePageHistory } from "./arrange-history";
import type { ArrangeHistories } from "./arrange-history";
import { resolveArrangeHistoryCommand } from "./arrange-shortcuts";
import { ConfirmDialog } from "./confirm-dialog";
import { DesktopGridView } from "./desktop-grid";
import { Dock } from "./dock";
import { EditAppDialog } from "./edit-app-dialog";
import { FolderDialog } from "./folder-dialog";
import { FolderOverlay } from "./folder-overlay";
import { MoveToFolderDialog, eligibleFoldersForMove } from "./move-to-folder-dialog";
import { normalizeSelection, selectAllIds, toggleSelection } from "./selection-state";
import { normalizeSelectionRect, selectIntersectingItemIds } from "./selection-geometry";
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

interface MarqueeState {
  readonly startX: number;
  readonly startY: number;
  readonly currentX: number;
  readonly currentY: number;
  readonly additive: boolean;
}

interface DesktopShellProps {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}

/**
 * The ready-state production desktop: fixed viewport, ambient wallpaper,
 * top bar, entity grid, page dots and floating dock.
 *
 * Local-first editing: every edit runs a pure operation, stages the
 * resulting snapshot immediately (UI updates without waiting for the
 * network), then fires an explicit sync. Arrange mode adds a session-only
 * selection (click, Cmd/Ctrl toggle, marquee, Cmd/Ctrl+A), rigid group
 * drags with a transient peer preview, keyboard nudges, and a per-page
 * Arrange history (drag/nudge movement only, 50 entries, never persisted).
 * Context menus, dialogs, selection and the folder overlay are
 * presentation-only shell state.
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

  /**
   * Presentation-only error for folder-overlay actions (Move to Desktop).
   * Never written into the workspace snapshot.
   */
  const [folderActionError, setFolderActionError] = useState<string | null>(null);

  const [selectedItemIds, setSelectedItemIds] = useState<ReadonlySet<LayoutItemId>>(new Set());
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [arrangeHistories, setArrangeHistories] = useState<ArrangeHistories>({});
  const arrange = mode === "arrange";

  const activePage = resolveActivePage(snapshot, sessionPageId);

  // Latest-value mirrors for async/session callbacks (drag commit, keyboard
  // navigation) that must always see the current render's data.
  const workspaceRef = useRef(workspace);
  const pageIdRef = useRef<DesktopPageId | null>(activePage?.id ?? null);
  const arrangeHistoriesRef = useRef(arrangeHistories);
  const selectionRef = useRef(selectedItemIds);
  const draggingRef = useRef(false);
  const lastDragEndedAtRef = useRef(0);
  const marqueeOriginRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const menuAreaRef = useRef<HTMLDivElement | null>(null);
  const layoutQueueRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  useEffect(() => {
    pageIdRef.current = activePage?.id ?? null;
  }, [activePage]);
  useEffect(() => {
    arrangeHistoriesRef.current = arrangeHistories;
  }, [arrangeHistories]);

  function applySelection(next: ReadonlySet<LayoutItemId>) {
    selectionRef.current = next;
    setSelectedItemIds(next);
  }

  function switchMode(next: DesktopMode) {
    setMode(next);
    // Leaving arrange clears the session selection; re-entering arrange
    // starts fresh (the per-page history survives the round-trip).
    if (next === "view") {
      applySelection(new Set());
    }
  }

  const switchToPage = useCallback((pageId: DesktopPageId) => {
    applySelection(new Set());
    setSessionPageId(pageId);
  }, []);

  function openFolderOverlay(folderId: EntityId) {
    setFolderActionError(null);
    setOverlayFolderId(folderId);
  }

  function closeFolderOverlay() {
    setFolderActionError(null);
    setOverlayFolderId(null);
  }

  /** Selection + history reconcile after every workspace/active-page change. */
  useEffect(() => {
    if (activePage === undefined) {
      return;
    }
    const validIds = new Set(activePage.layout.items.map((item) => item.id));
    const normalized = normalizeSelection(selectionRef.current, validIds);
    if (normalized !== selectionRef.current) {
      applySelection(normalized);
    }
    setArrangeHistories((current) =>
      reconcilePageHistory(current, activePage.id, activePage.layout),
    );
  }, [activePage]);

  /**
   * Serialized local-first layout commits: compute the candidate history,
   * stage the new snapshot, and only accept the candidate history after a
   * successful stage — a stage failure rolls the candidate back by never
   * accepting it into state.
   */
  const enqueueLayoutCommit = useCallback(
    (pageId: DesktopPageId, movedLayout: PageLayout) => {
      const run = async () => {
        const current = workspaceRef.current;
        const page = findDesktopPage(current.snapshot, pageId);
        if (page === undefined) {
          return;
        }
        const base = arrangeHistoriesRef.current[pageId] ?? createLayoutHistory(page.layout);
        const candidate = commitLayout(base, movedLayout);
        if (candidate === base) {
          // Resolved back to the same layout: no semantic change, no
          // history entry, no staging.
          return;
        }
        const replaced = replacePageLayout(current.snapshot, pageId, candidate.present);
        if (!replaced.ok) {
          return;
        }
        const staged = await stageWorkspaceAndTrySync(runtime, replaced.workspace);
        if (!staged.ok) {
          console.error(`VelaDesk: layout change was not staged (${staged.reason})`);
          return;
        }
        const nextMap: ArrangeHistories = {
          ...arrangeHistoriesRef.current,
          [pageId]: candidate,
        };
        arrangeHistoriesRef.current = nextMap;
        setArrangeHistories(nextMap);
      };
      layoutQueueRef.current = layoutQueueRef.current.then(run, run);
    },
    [runtime]
  );

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
      enqueueLayoutCommit(pageId, movedLayout);
    },
    [enqueueLayoutCommit]
  );

  /** Undo/Redo: the resulting layout is a brand-new local edit. */
  const applyHistoryStep = useCallback(
    (pageId: DesktopPageId, direction: "undo" | "redo") => {
      const run = async () => {
        const base = arrangeHistoriesRef.current[pageId];
        if (base === undefined) {
          return;
        }
        const candidate = direction === "undo" ? undoLayout(base) : redoLayout(base);
        if (candidate === base) {
          return;
        }
        const current = workspaceRef.current;
        const page = findDesktopPage(current.snapshot, pageId);
        if (page === undefined || page.layout !== base.present) {
          // The layout moved on since reconciliation — reset this page's
          // history instead of writing a stale snapshot.
          if (page !== undefined) {
            setArrangeHistories((current2) =>
              reconcilePageHistory(current2, pageId, page.layout),
            );
          }
          return;
        }
        const replaced = replacePageLayout(current.snapshot, pageId, candidate.present);
        if (!replaced.ok) {
          return;
        }
        const staged = await stageWorkspaceAndTrySync(runtime, replaced.workspace);
        if (!staged.ok) {
          console.error(`VelaDesk: ${direction} was not staged (${staged.reason})`);
          return;
        }
        const nextMap: ArrangeHistories = {
          ...arrangeHistoriesRef.current,
          [pageId]: candidate,
        };
        arrangeHistoriesRef.current = nextMap;
        setArrangeHistories(nextMap);
      };
      layoutQueueRef.current = layoutQueueRef.current.then(run, run);
    },
    [runtime]
  );

  /** Keyboard nudge: exact one-cell rigid translation of the selection. */
  const nudgeSelection = useCallback(
    (columnDelta: number, rowDelta: number) => {
      const pageId = pageIdRef.current;
      if (pageId === null || selectionRef.current.size === 0) {
        return;
      }
      const current = workspaceRef.current;
      const page = findDesktopPage(current.snapshot, pageId);
      if (page === undefined) {
        return;
      }
      const result = moveItems(
        page.layout,
        [...selectionRef.current],
        { columnDelta, rowDelta },
        { placement: "exact" }
      );
      if (!result.ok || result.layout === page.layout) {
        // Failed nudge: no change, no history entry, no sync.
        return;
      }
      enqueueLayoutCommit(pageId, result.layout);
    },
    [enqueueLayoutCommit]
  );

  const { gridRef, metrics } = useGridMetrics(
    activePage !== undefined ? activePage.layout.grid : { columns: 1, rows: 1 }
  );
  const { dragging, handleDragStart, handleDragMove, handleDragEnd } = useAtomicGridDrag({
    layout: activePage !== undefined ? activePage.layout : null,
    metrics,
    onCommit: commitDraggedLayout,
    getDragItemIds: useCallback(
      (sourceId: LayoutItemId) => resolveDragItemIds(sourceId, selectionRef.current),
      []
    ),
    resolveItemElement: useCallback((itemId: LayoutItemId) => {
      // The menu-area wrapper is display:contents; DOM queries still work.
      return (
        menuAreaRef.current?.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`) ?? null
      );
    }, []),
  });
  useEffect(() => {
    draggingRef.current = dragging;
  }, [dragging]);

  const wrappedHandleDragStart = useCallback(
    (event: Parameters<typeof handleDragStart>[0]) => {
      // Drag-source selection semantics: grabbing an unselected item makes
      // it the whole drag; grabbing a selected one drags the selection.
      const sourceId = event.operation.source?.id;
      if (sourceId !== undefined && !selectionRef.current.has(String(sourceId))) {
        applySelection(new Set([String(sourceId)]));
      }
      handleDragStart(event);
    },
    [handleDragStart]
  );

  const wrappedHandleDragEnd = useCallback(
    (event: Parameters<typeof handleDragEnd>[0]) => {
      lastDragEndedAtRef.current = Date.now();
      handleDragEnd(event);
    },
    [handleDragEnd]
  );

  const handleItemSelect = useCallback((entityId: EntityId, toggle: boolean) => {
    // A drag releases the pointer with a click; never let it clobber the
    // group selection the drag just moved.
    if (Date.now() - lastDragEndedAtRef.current < 250) {
      return;
    }
    applySelection(
      toggle ? toggleSelection(selectionRef.current, entityId) : new Set([entityId])
    );
  }, []);

  // --- Arrange marquee (rubber-band) selection ---------------------------
  const handleViewportPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!arrange || draggingRef.current || event.button !== 0) {
        return;
      }
      // Only the empty grid background starts a marquee — never an item.
      if (event.target !== event.currentTarget) {
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      marqueeOriginRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      setMarquee({
        startX: event.clientX,
        startY: event.clientY,
        currentX: event.clientX,
        currentY: event.clientY,
        additive: event.metaKey || event.ctrlKey,
      });
    },
    [arrange]
  );

  const handleViewportPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = marqueeOriginRef.current;
    if (origin === null || origin.pointerId !== event.pointerId) {
      return;
    }
    setMarquee((current) =>
      current === null
        ? current
        : { ...current, currentX: event.clientX, currentY: event.clientY },
    );
  }, []);

  const handleViewportPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = marqueeOriginRef.current;
      const state = marquee;
      if (origin === null || state === null || origin.pointerId !== event.pointerId) {
        return;
      }
      marqueeOriginRef.current = null;
      setMarquee(null);
      const moved = Math.hypot(state.currentX - state.startX, state.currentY - state.startY);
      if (moved < 4) {
        // Blank click: plain clears the selection, additive keeps it.
        if (!state.additive) {
          applySelection(new Set());
        }
        return;
      }
      const grid = menuAreaRef.current?.querySelector(".vela-desktop__viewport");
      if (grid === null) {
        return;
      }
      const marqueeRect = normalizeSelectionRect(
        { left: state.startX, top: state.startY, right: state.startX, bottom: state.startY },
        {
          left: state.currentX,
          top: state.currentY,
          right: state.currentX,
          bottom: state.currentY,
        },
      );
      const items = Array.from(
        (grid as HTMLElement).querySelectorAll<HTMLElement>("[data-item-id]"),
      ).map((element) => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.itemId ?? "", rect };
      });
      const hitIds = selectIntersectingItemIds(items, marqueeRect);
      const next = new Set(state.additive ? selectionRef.current : new Set<string>());
      for (const id of hitIds) {
        if (id) {
          next.add(id);
        }
      }
      applySelection(next);
    },
    [marquee]
  );

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
            onSelect: () => switchMode(arrange ? "view" : "arrange"),
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
        onOpenFolder: (folderId) => openFolderOverlay(folderId),
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
      setFolderActionError(
        result.reason === "no-space"
          ? "Not enough room on this page to move the app out of the folder."
          : "The app could not be moved to the desktop."
      );
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setFolderActionError("The app could not be moved to the desktop.");
      return;
    }
    setFolderActionError(null);
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
      closeFolderOverlay();
    }
    closeDialog();
  }

  // Keyboard: undo/redo, select all, Escape selection clear, arrow nudge
  // (taking priority over page switching while a selection exists).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const inField =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const surfaceOpen = contextMenu !== null || dialog !== null || overlayFolderId !== null;

      if (event.key === "Escape") {
        // Open surfaces consume Escape themselves; otherwise it clears the
        // session selection.
        if (!surfaceOpen && arrange && selectionRef.current.size > 0) {
          event.preventDefault();
          applySelection(new Set());
        }
        return;
      }
      if (inField) {
        return;
      }

      if (
        arrange &&
        !surfaceOpen &&
        !draggingRef.current &&
        (event.metaKey || event.ctrlKey) &&
        !event.altKey
      ) {
        const pageId = pageIdRef.current;
        // Availability comes from the imperative history map, never the
        // closure's React state — a keydown must see the freshest history.
        const command = resolveArrangeHistoryCommand({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          canUndo: pageId !== null && canUndo(arrangeHistoriesRef.current, pageId),
          canRedo: pageId !== null && canRedo(arrangeHistoriesRef.current, pageId),
        });
        if (pageId !== null && command !== null) {
          // Only a runnable command is consumed: an unavailable undo/redo
          // leaves the event untouched for the browser/OS.
          event.preventDefault();
          applyHistoryStep(pageId, command);
          return;
        }
        if (event.key.toLowerCase() === "a" && activePage !== undefined) {
          event.preventDefault();
          applySelection(selectAllIds(new Set(activePage.layout.items.map((item) => item.id))));
          return;
        }
      }

      const isArrow =
        event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown";
      if (!isArrow) {
        return;
      }
      if (arrange && !surfaceOpen && !draggingRef.current && selectionRef.current.size > 0) {
        // A held key never produces extra history entries.
        if (event.repeat) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        if (event.key === "ArrowLeft") nudgeSelection(-1, 0);
        if (event.key === "ArrowRight") nudgeSelection(1, 0);
        if (event.key === "ArrowUp") nudgeSelection(0, -1);
        if (event.key === "ArrowDown") nudgeSelection(0, 1);
        return;
      }

      // Page switching — Left/Right only, never while dragging, and never
      // while a selection owns the arrows.
      if (dragging || surfaceOpen) {
        return;
      }
      if (arrange && selectionRef.current.size > 0) {
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      const pages = workspaceRef.current.snapshot.pages;
      if (pages.length < 2) {
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
        switchToPage(pages[nextIndex]!.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [arrange, contextMenu, dialog, overlayFolderId, dragging, activePage, nudgeSelection, applyHistoryStep, switchToPage]);

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
        {arrange ? (
          <span className="vela-topbar__arrange-cluster">
            <button
              type="button"
              className="vela-button vela-topbar__history-button"
              title="Undo arrange (Ctrl/Cmd+Z)"
              aria-label="Undo arrange"
              disabled={dragging || !canUndo(arrangeHistories, activePage.id)}
              onClick={() => applyHistoryStep(activePage.id, "undo")}
            >
              ⟲
            </button>
            <button
              type="button"
              className="vela-button vela-topbar__history-button"
              title="Redo arrange (Ctrl/Cmd+Shift+Z)"
              aria-label="Redo arrange"
              disabled={dragging || !canRedo(arrangeHistories, activePage.id)}
              onClick={() => applyHistoryStep(activePage.id, "redo")}
            >
              ⟳
            </button>
            {selectedItemIds.size > 0 ? (
              <>
                <span className="vela-topbar__selection-count" aria-live="polite">
                  {selectedItemIds.size} selected
                </span>
                <button
                  type="button"
                  className="vela-button"
                  aria-label="Clear selection"
                  onClick={() => applySelection(new Set())}
                >
                  Clear
                </button>
              </>
            ) : null}
          </span>
        ) : null}
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
            onClick={() => switchMode("view")}
          >
            View
          </button>
          <button
            type="button"
            className="vela-segment__button"
            aria-pressed={arrange}
            disabled={dragging}
            onClick={() => switchMode("arrange")}
          >
            Arrange
          </button>
        </div>
      </header>

      <DragDropProvider
        onDragStart={wrappedHandleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={wrappedHandleDragEnd}
      >
        <div className="vela-desktop__menu-area" ref={menuAreaRef}>
          <div
            className="vela-desktop__area-shell"
            onContextMenu={(event) => {
              // Only reached when no entity handled the event (entities stop
              // propagation).
              event.preventDefault();
              openContextMenu({ kind: "desktop", x: event.clientX, y: event.clientY });
            }}
          >
            <DesktopGridView
              layout={activePage.layout}
              workspace={snapshot}
              arrange={arrange}
              metrics={metrics}
              gridRef={gridRef}
              selectedIds={selectedItemIds}
              onItemSelect={handleItemSelect}
              onEntityContextMenu={(entityId, x, y) =>
                openContextMenu({ kind: "entity", entityId, source: "desktop", x, y })
              }
              onOpenFolder={(folderId) => openFolderOverlay(folderId)}
              onViewportPointerDown={handleViewportPointerDown}
              onViewportPointerMove={handleViewportPointerMove}
              onViewportPointerUp={handleViewportPointerUp}
            />
          </div>
        </div>
      </DragDropProvider>

      {marquee !== null ? (
        <div
          className="vela-marquee"
          style={{
            left: Math.min(marquee.startX, marquee.currentX),
            top: Math.min(marquee.startY, marquee.currentY),
            width: Math.abs(marquee.currentX - marquee.startX),
            height: Math.abs(marquee.currentY - marquee.startY),
          }}
        />
      ) : null}

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
              onClick={() => switchToPage(page.id)}
            />
          ))}
        </div>
      ) : null}

      <Dock
        workspace={snapshot}
        arrange={arrange}
        dragging={dragging}
        onToggleMode={() => switchMode(arrange ? "view" : "arrange")}
        onCreateMenu={(x, y) => openContextMenu({ kind: "desktop", x, y })}
        onOpenFolder={(folderId) => openFolderOverlay(folderId)}
        onEntityContextMenu={(entityId, x, y) =>
          openContextMenu({ kind: "entity", entityId, source: "dock", x, y })
        }
      />

      {overlayFolder !== undefined ? (
        <FolderOverlay
          folder={overlayFolder}
          workspace={snapshot}
          error={folderActionError ?? undefined}
          onClose={closeFolderOverlay}
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
 * only (placed or dock-pinned, excluding the current one). With several
 * items selected the menu still targets only the right-clicked entity.
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
    const eligible = eligibleFoldersForMove(
      snapshot,
      source === "folder" ? containerFolderId(snapshot, entity.id) : null
    );
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
  return [
    { id: "widget-later", label: "Widget editing later", disabled: true, onSelect: () => {} },
  ];
}

function containerFolderId(workspace: WorkspaceSnapshot, appId: EntityId): EntityId | null {
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
