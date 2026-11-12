"use client";

import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";

import type { WorkspaceClientRuntime } from "@veladesk/client-runtime";
import {
  findDesktopPage,
  movePage,
  pageItemIds,
  pinEntityToDock,
  resolvePagePlacement,
  setDefaultPage,
  unpinEntityFromDock,
} from "@veladesk/domain";
import type {
  AppShortcut,
  DesktopPage,
  DesktopPageId,
  EntityId,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";

import type { ArrangeCanvasHistories } from "../../canvas/arrange-history";
import { canRedo, canUndo } from "../../canvas/arrange-history";
import type { PendingCanvasHandoff } from "../../canvas/canvas-handoff";
import type { PagePlacementMode } from "@veladesk/canvas-engine";
import { GRID_SIZE_STEPS } from "../../canvas/canvas-resize";
import type { ResizeCommitGeometry } from "../../canvas/canvas-resize";
import { launchApp } from "../launch-app";
import {
  buildAppMenuEntries,
  buildDesktopCommandEntries,
  buildFolderMenuEntries,
  buildSectionMenuEntries,
} from "../desktop-command-menu";
import { openAppearanceSession } from "../app-appearance-session";
import type { AppAppearanceSession } from "../app-appearance-session";
import type { LauncherEntry, LauncherCommandId } from "../launcher-types";
import { useWorkspaceManager } from "../workspace-manager";
import { stageWorkspaceAndTrySync } from "../workspace-commit";
import type { ContextMenuState } from "../context-menu";
import type { DesktopMode, HomeDialog, ContextMenuTarget } from "./shell-context";
import type { TranslateFn } from "../../i18n/use-i18n";

/** The page whose canvas currently holds this entity, when any. */
export function containerPageId(
  workspace: WorkspaceSnapshot,
  entityId: EntityId
): DesktopPageId | null {
  const page = workspace.pages.find((candidate) => pageItemIds(candidate).includes(entityId));
  return page?.id ?? null;
}

export interface UseDesktopMenusInput {
  readonly runtime: WorkspaceClientRuntime;
  readonly t: TranslateFn;
  /** Opens (or closes) the shell's context-menu surface. */
  readonly setContextMenu: (next: ContextMenuState | null) => void;
  /** The workspace record (sync state feeds the command menu). */
  readonly workspace: LocalWorkspaceRecord;
  /** The render's authoritative snapshot. */
  readonly snapshot: WorkspaceSnapshot;
  readonly arrange: boolean;
  readonly mode: DesktopMode;
  readonly activePage: DesktopPage | undefined;
  readonly effectiveActivePageId: DesktopPageId | null;
  readonly workspaceManager: ReturnType<typeof useWorkspaceManager>;
  /** The scene's section switch (instant when navigating to edit a tile). */
  readonly switchSection: (pageId: DesktopPageId, options?: { readonly animate?: boolean }) => void;
  readonly switchMode: (next: DesktopMode) => void;
  /** Canvas command layer pieces (placement mode, undo/redo, locks). */
  readonly setPlacementMode: (next: PagePlacementMode) => void;
  readonly applyHistoryStep: (pageId: DesktopPageId, direction: "undo" | "redo") => void;
  /** Commits a menu-driven resize (the explicit 尺寸 controls, Helm r3). */
  readonly commitResizedGeometry: (entityId: EntityId, geometry: ResizeCommitGeometry) => void;
  readonly freeformBlockedReason: string | null;
  readonly arrangeHistoriesRef: RefObject<ArrangeCanvasHistories>;
  readonly draggingRef: RefObject<boolean>;
  readonly pendingHandoffRef: RefObject<PendingCanvasHandoff | null>;
  readonly pageIdRef: RefObject<DesktopPageId | null>;
  /** Dialog/overlay session. */
  readonly openDialog: (next: HomeDialog) => void;
  readonly openFolderOverlay: (folderId: EntityId) => void;
  readonly setLauncherOpen: (open: boolean | ((current: boolean) => boolean)) => void;
  readonly setAppearanceSession: (
    next: AppAppearanceSession | null | ((current: AppAppearanceSession | null) => AppAppearanceSession | null)
  ) => void;
  /** Settings session. */
  readonly openSettings: () => void;
  readonly openSectionBackgroundSettings: (pageId: DesktopPageId) => void;
  /** Structural-reveal channel (create/reorder/delete-active). */
  readonly pendingRevealRef: RefObject<DesktopPageId | null>;
}

/**
 * The shell's menu + launcher command layer (P1-ENG-1), extracted verbatim
 * from the former desktop-shell.tsx: the context-menu surface (desktop
 * command menu, entity menu, section menu), the launcher activation
 * orchestration and the dock/section domain edits the menus trigger.
 */
export function useDesktopMenus(input: UseDesktopMenusInput) {
  const {
    runtime,
    t,
    setContextMenu,
    workspace,
    snapshot,
    arrange,
    mode,
    activePage,
    effectiveActivePageId,
    workspaceManager,
    switchSection,
    switchMode,
    setPlacementMode,
    applyHistoryStep,
    commitResizedGeometry,
    freeformBlockedReason,
    arrangeHistoriesRef,
    draggingRef,
    pendingHandoffRef,
    pageIdRef,
    openDialog,
    openFolderOverlay,
    setLauncherOpen,
    setAppearanceSession,
    openSettings,
    openSectionBackgroundSettings,
    pendingRevealRef,
  } = input;

  function openContextMenu(target: ContextMenuTarget) {
    if (target.kind === "desktop") {
      openDesktopCommandMenu(target.x, target.y);
      return;
    }
    if (target.kind === "section") {
      openSectionMenu(target.pageId, target.x, target.y);
      return;
    }
    openEntityMenu(target.entityId, target.x, target.y);
  }

  function openDesktopCommandMenu(x: number, y: number) {
    const currentPageId = pageIdRef.current;
    const historyUsable =
      currentPageId !== null && !draggingRef.current && pendingHandoffRef.current === null;
    setContextMenu({
      x,
      y,
      entries: buildDesktopCommandEntries({
        t,
        arrange,
        placementMode: activePage === undefined ? "grid" : resolvePagePlacement(activePage).mode,
        freeformBlockedReason,
        canUndo:
          historyUsable && currentPageId !== null && canUndo(arrangeHistoriesRef.current, currentPageId),
        canRedo:
          historyUsable && currentPageId !== null && canRedo(arrangeHistoriesRef.current, currentPageId),
        syncState: workspace.syncState,
        ...(workspaceManager === null ? {} : { workspaceMenu: workspaceManager.menu }),
        callbacks: {
          onAddApp: () => openDialog({ kind: "add-app", pageId: pageDestination() }),
          onNewSection: () => openDialog({ kind: "new-section" }),
          onSearch: () => setLauncherOpen(true),
          onToggleMode: () => switchMode(arrange ? "view" : "arrange"),
          onSetPlacementMode: setPlacementMode,
          onUndo: () => {
            if (pageIdRef.current !== null) {
              applyHistoryStep(pageIdRef.current, "undo");
            }
          },
          onRedo: () => {
            if (pageIdRef.current !== null) {
              applyHistoryStep(pageIdRef.current, "redo");
            }
          },
          onSync: () => void runtime.syncCurrent(),
          // t137 (Chris): opening Settings from a section's canvas (this
          // menu is the section's empty-canvas right-click) preselects THAT
          // section in the background editor — the same smart entry the
          // section pill's 编辑背景 uses. No page context (defensive): the
          // plain workspace-default entry.
          onOpenSettings: () =>
            currentPageId !== null ? openSectionBackgroundSettings(currentPageId) : openSettings(),
        },
      }),
    });
  }

  /**
   * The explicit 尺寸 controls of a placed APP's context menu (Helm r3):
   * the four designed Grid size steps (radio on the current one), or the
   * four freeform grow/shrink directions — deterministic resizing beside
   * the eight handles, committing through the same geometry path (handoff,
   * history, persistence) as a handle drag.
   */
  function sizeControlsOf(entityId: EntityId) {
    if (!arrange || activePage === undefined) {
      return undefined;
    }
    const placement = resolvePagePlacement(activePage);
    if (placement.mode === "grid") {
      const item = placement.items.find((candidate) => candidate.id === entityId);
      if (item === undefined) {
        return undefined;
      }
      return {
        kind: "grid" as const,
        steps: GRID_SIZE_STEPS.map((step) => {
          // The width clamps to the page's right edge (rows are unbounded);
          // the anchor stays at the tile's own top-left cell.
          const width = Math.min(step.w, Math.max(1, placement.columns - item.column));
          return {
            id: `${step.w}x${step.h}`,
            label: `${step.w}×${step.h}`,
            checked: item.columnSpan === width && item.rowSpan === step.h,
            onSelect: () =>
              commitResizedGeometry(entityId, {
                kind: "grid",
                geometry: {
                  column: item.column,
                  row: item.row,
                  columnSpan: width,
                  rowSpan: step.h,
                },
              }),
          };
        }),
      };
    }
    const item = placement.items.find((candidate) => candidate.id === entityId);
    if (item === undefined || !("rect" in item)) {
      return undefined;
    }
    /** One freeform size step, in the canvas's 0–10000 logical units. */
    const FREEFORM_SIZE_STEP = 625;
    const move = (axis: "width" | "height", sign: 1 | -1) => {
      const next = Math.min(
        Math.max(500, item.rect[axis] + sign * FREEFORM_SIZE_STEP),
        axis === "width" ? 10000 - item.rect.x : 10000 - item.rect.y,
      );
      commitResizedGeometry(entityId, {
        kind: "freeform",
        rect: { ...item.rect, [axis]: next },
      });
    };
    return {
      kind: "freeform" as const,
      onWider: () => move("width", 1),
      onNarrower: () => move("width", -1),
      onTaller: () => move("height", 1),
      onShorter: () => move("height", -1),
    };
  }

  function openEntityMenu(entityId: EntityId, x: number, y: number) {
    const entity = snapshot.entities.find((candidate) => candidate.id === entityId);
    if (entity === undefined) {
      setContextMenu({ x, y, entries: [] });
      return;
    }
    const pinned = snapshot.dock.items.includes(entity.id);
    if (entity.kind === "app") {
      setContextMenu({
        x,
        y,
        entries: buildAppMenuEntries({
          t,
          pinned,
          sizeControls: sizeControlsOf(entity.id),
          callbacks: {
            onOpen: () => launchApp(entity),
            onEdit: () => openDialog({ kind: "edit-app", entityId: entity.id }),
            onEditAppearance: () => {
              // The REAL desktop tile is the preview (019-C): make sure the
              // owning section is on screen so the edited app is visible.
              const owningPageId = containerPageId(snapshot, entity.id);
              if (owningPageId !== null && owningPageId !== effectiveActivePageId) {
                switchSection(owningPageId, { animate: false });
              }
              setAppearanceSession(openAppearanceSession(entity));
              openDialog({ kind: "edit-visual", entityId: entity.id });
            },
            onMoveToSection: () => openDialog({ kind: "move-to-section", appId: entity.id }),
            onPinToggle: () =>
              void runDockEdit((input2) =>
                pinned ? unpinEntityFromDock(input2, entity.id) : pinEntityToDock(input2, entity.id)
              ),
            onDelete: () => openDialog({ kind: "delete-app", entityId: entity.id }),
          },
        }),
      });
      return;
    }
    if (entity.kind === "folder") {
      setContextMenu({
        x,
        y,
        entries: buildFolderMenuEntries({
          t,
          pinned,
          callbacks: {
            onOpen: () => openFolderOverlay(entity.id),
            onRename: () => openDialog({ kind: "rename-folder", folderId: entity.id }),
            onPinToggle: () =>
              void runDockEdit((input2) =>
                pinned ? unpinEntityFromDock(input2, entity.id) : pinEntityToDock(input2, entity.id)
              ),
            onDissolve: () => openDialog({ kind: "delete-folder", folderId: entity.id }),
          },
        }),
      });
      return;
    }
    // Widgets are not editable in this stage — one quiet row.
    setContextMenu({
      x,
      y,
      entries: [
        { kind: "action", id: "widget-later", label: t("menu.widgetLater"), disabled: true, onSelect: () => {} },
      ],
    });
  }

  function openSectionMenu(pageId: DesktopPageId, x: number, y: number) {
    const page = findDesktopPage(snapshot, pageId);
    if (page === undefined) {
      return;
    }
    const index = snapshot.pages.findIndex((candidate) => candidate.id === pageId);
    setContextMenu({
      x,
      y,
      entries: buildSectionMenuEntries({
        t,
        isDefault: pageId === snapshot.preferences.defaultPageId,
        isFirst: index === 0,
        isLast: index === snapshot.pages.length - 1,
        isEmpty: pageItemIds(page).length === 0,
        callbacks: {
          onRename: () => openDialog({ kind: "rename-section", pageId }),
          onBackground: () => openSectionBackgroundSettings(pageId),
          onSetDefault: () => void runSectionEdit(setDefaultPage(snapshot, pageId), null),
          onMoveUp: () => void runSectionEdit(movePage(snapshot, pageId, "up"), pageId),
          onMoveDown: () => void runSectionEdit(movePage(snapshot, pageId, "down"), pageId),
          onDelete: () => openDialog({ kind: "delete-section", pageId }),
        },
      }),
    });
  }

  function pageDestination(): DesktopPageId {
    return effectiveActivePageId ?? snapshot.pages[0]?.id ?? "page";
  }

  /**
   * Launcher activation orchestration: entries are pure data, the shell
   * resolves them against the live snapshot (a stale entry can no longer
   * launch). Section results switch the explicit active section.
   */
  function activateLauncherEntry(entry: LauncherEntry) {
    setLauncherOpen(false);
    switch (entry.kind) {
      case "app": {
        const app = snapshot.entities.find(
          (candidate): candidate is AppShortcut =>
            candidate.kind === "app" && candidate.id === entry.entityId,
        );
        if (app !== undefined) {
          launchApp(app);
        }
        return;
      }
      case "folder":
        openFolderOverlay(entry.entityId);
        return;
      case "page":
        switchSection(entry.pageId);
        return;
      case "command":
        activateLauncherCommand(entry.commandId);
        return;
    }
  }

  function activateLauncherCommand(commandId: LauncherCommandId) {
    if (commandId.startsWith("workspace:")) { workspaceManager?.select(commandId.slice("workspace:".length)); return; }
    switch (commandId) {
      case "new-workspace":
        workspaceManager?.create();
        return;
      case "add-app":
        openDialog({ kind: "add-app", pageId: pageDestination() });
        return;
      case "new-section":
        openDialog({ kind: "new-section" });
        return;
      case "open-settings":
        openSettings();
        return;
      case "toggle-mode":
        switchMode(mode === "arrange" ? "view" : "arrange");
        return;
      case "sync-current":
        void runtime.syncCurrent();
        return;
    }
  }

  /**
   * Runs a domain dock edit and stages it. Dock edits have no inline error
   * surface of their own (menu actions) — failures are logged, never
   * silently swallowed into a fake success.
   */
  async function runDockEdit(
    edit: (snapshot: WorkspaceSnapshot) => ReturnType<typeof pinEntityToDock>
  ) {
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

  /** Runs a section-structure edit and stages it; reveal kept on `pageId`. */
  async function runSectionEdit(
    result: ReturnType<typeof movePage>,
    revealPageId: DesktopPageId | null
  ) {
    if (!result.ok) {
      console.error(`VelaDesk: section edit refused (${result.reason})`);
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      console.error(`VelaDesk: section edit was not staged (${staged.reason})`);
      return;
    }
    if (revealPageId !== null) {
      // The DOM order changed; the very next commit switches back to the
      // SAME section so the user never sees a neighbor flash by.
      pendingRevealRef.current = revealPageId;
    }
  }

  /**
   * Layer-stable context-menu entry points: the raw builders above are
   * recreated per render, so the returned callbacks mirror them through a
   * latest-value ref — the identity never churns (warm tile layers
   * memoize their props, 020-A2 §18) while the menu is still built from
   * the freshest render's state.
   */
  const openContextMenuRef = useRef(openContextMenu);
  useEffect(() => {
    openContextMenuRef.current = openContextMenu;
  });
  const stableOpenContextMenu = useCallback((target: ContextMenuTarget) => {
    openContextMenuRef.current(target);
  }, []);
  const openEntityContextMenu = useCallback(
    (entityId: EntityId, x: number, y: number) => {
      stableOpenContextMenu({ kind: "entity", entityId, source: "desktop", x, y });
    },
    [stableOpenContextMenu]
  );

  return {
    openContextMenu: stableOpenContextMenu,
    openEntityContextMenu,
    openDesktopCommandMenu,
    activateLauncherEntry,
    containerPageId,
  };
}
