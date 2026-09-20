"use client";

import { DragDropProvider, useDragDropManager } from "@dnd-kit/react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  deleteApp,
  deleteEmptyPage,
  dissolveFolderToPage,
  findDesktopPage,
  movePage,
  pinEntityToDock,
  replaceWorkspacePreferences,
  resolveWorkspaceAppearance,
  setDefaultPage,
  unpinEntityFromDock,
} from "@veladesk/domain";
import type {
  AppShortcut,
  DesktopPageId,
  EntityId,
  Folder,
  WorkspaceAppearancePreferences,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import {
  arePageLayoutsEqual,
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
} from "./context-menu";
import type { ContextMenuState } from "./context-menu";
import { AddAppDialog } from "./add-app-dialog";
import { AppVisualEditor } from "./app-visual-editor";
import { canRedo, canUndo, reconcilePageHistory } from "./arrange-history";
import type { ArrangeHistories } from "./arrange-history";
import { resolveArrangeHistoryCommand } from "./arrange-shortcuts";
import { ConfirmDialog } from "./confirm-dialog";
import { DesktopGridView } from "./desktop-grid";
import { Dock } from "./dock";
import { resolveDockEntities } from "./dock-model";
import { EditAppDialog } from "./edit-app-dialog";
import { FolderDialog } from "./folder-dialog";
import { FolderOverlay } from "./folder-overlay";
import {
  buildAppMenuEntries,
  buildDesktopCommandEntries,
  buildFolderMenuEntries,
  buildSectionMenuEntries,
} from "./desktop-command-menu";
import type { DesktopMenuEntry } from "./desktop-command-menu";
import { MoveToSectionDialog } from "./move-to-section-dialog";
import { SectionDialog } from "./section-dialog";
import { SectionNavigation } from "./section-navigation";
import { SectionSyncStatus } from "./section-sync-status";
import { normalizeSelection, selectAllIds, toggleSelection } from "./selection-state";
import { normalizeSelectionRect, selectIntersectingItemIds } from "./selection-geometry";
import {
  nextSectionId,
  previousSectionId,
  resolveSectionAfterDelete,
  sectionNavDirection,
} from "./section-navigation-model";
import { useSectionNavigation } from "./use-section-navigation";
import { replacePageLayout } from "./workspace-layout";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import {
  reconcileHandoff,
  resolveDisplayLayout,
} from "./layout-handoff";
import type { PendingLayoutHandoff } from "./layout-handoff";
import { launchApp } from "./launch-app";
import { buildAppearanceTheme } from "./appearance-theme";
import { disableDndDropAnimation } from "./dnd-static-drop";
import { useI18n } from "../i18n/use-i18n";
import { Launcher } from "./launcher";
import { buildLauncherEntries } from "./launcher-index";
import type { LauncherCommandId, LauncherEntry } from "./launcher-types";
import { SettingsCenter } from "./settings-center";
import type { SettingsSaveResult } from "./settings-center";
import {
  preferencesFromSettingsDraft,
} from "./settings-draft";
import type { WorkspaceSettingsDraft } from "./settings-draft";
import "./home-shell.css";

/** UI-only desktop mode. Session state — never persisted back to preferences. */
export type DesktopMode = "view" | "arrange";

/**
 * Which context-menu surface was opened. Presentation-only shell state.
 * The desktop command menu (empty area / nav ⋯ / dock chrome) is built by
 * `buildDesktopCommandEntries`; entities and sections get their own
 * builders from the same module.
 */
export type ContextMenuTarget =
  | {
      readonly kind: "entity";
      readonly entityId: EntityId;
      readonly source: "desktop" | "dock" | "folder";
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "section";
      readonly pageId: DesktopPageId;
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
  | { readonly kind: "add-app"; readonly pageId: DesktopPageId }
  | { readonly kind: "edit-app"; readonly entityId: EntityId }
  | { readonly kind: "edit-visual"; readonly entityId: EntityId }
  | { readonly kind: "delete-app"; readonly entityId: EntityId }
  | { readonly kind: "new-section" }
  | { readonly kind: "rename-section"; readonly pageId: DesktopPageId }
  | { readonly kind: "delete-section"; readonly pageId: DesktopPageId }
  | { readonly kind: "move-to-section"; readonly appId: EntityId }
  | { readonly kind: "rename-folder"; readonly folderId: EntityId }
  | { readonly kind: "delete-folder"; readonly folderId: EntityId };

interface MarqueeState {
  readonly startX: number;
  readonly startY: number;
  readonly currentX: number;
  readonly currentY: number;
  readonly additive: boolean;
}

/**
 * How one serialized layout-commit attempt ended. Internal to the shell —
 * the drop handoff must know whether the durable local stage landed, was a
 * no-op, or failed, but this is never part of a package API.
 */
type LayoutCommitOutcome =
  | { readonly status: "staged" }
  | { readonly status: "noop" }
  | { readonly status: "failed" };

const EMPTY_SELECTION: ReadonlySet<LayoutItemId> = new Set();

interface DesktopShellProps {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}

/**
 * The ready-state production desktop (task 015 IA): a full-viewport
 * scroll-snap section stack, a floating left section navigation, an
 * optional pinned-entity dock, and the custom context menu as the primary
 * command surface. No top bar, no page dots, no utility dock.
 *
 * The REAL scroll position is the source of truth for the active section
 * (IntersectionObserver); navigation only ever scrolls the container.
 * Local-first editing: every edit runs a pure operation, stages the
 * resulting snapshot immediately, then fires an explicit sync. Arrange
 * mode belongs to the ACTIVE section only — selection, drags, nudges and
 * the per-page history never cross sections.
 */
export function DesktopShell({ workspace, lastRemoteResult }: DesktopShellProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { locale, setLocale, t } = useI18n();
  const snapshot = workspace.snapshot;

  const [mode, setMode] = useState<DesktopMode>(() =>
    snapshot.preferences.layoutLocked ? "view" : "arrange"
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<HomeDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [overlayFolderId, setOverlayFolderId] = useState<EntityId | null>(null);

  /**
   * Presentation-only error for folder-overlay actions (dissolve). Never
   * written into the workspace snapshot.
   */
  const [folderActionError, setFolderActionError] = useState<string | null>(null);

  const [selectedItemIds, setSelectedItemIds] = useState<ReadonlySet<LayoutItemId>>(EMPTY_SELECTION);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const [arrangeHistories, setArrangeHistories] = useState<ArrangeHistories>({});
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * Session-only live preview from the Settings Center. It never stages or
   * syncs; it is dropped on Cancel and on a successful Save (the persisted
   * snapshot then carries the same appearance, so no flash-back).
   */
  const [appearancePreview, setAppearancePreview] = useState<WorkspaceAppearancePreferences | null>(null);
  /**
   * Session-only optimistic display layout for a just-dropped arrange drag.
   * It is established synchronously at drop time — before any IndexedDB
   * promise is awaited — so the CSS grid shows the destination the moment
   * the dnd-kit transform steps down, and the authoritative snapshot
   * catches up invisibly a few frames later. Presentation state only: it
   * never touches the WorkspaceSnapshot, IndexedDB, the server or
   * localStorage, and dies with the session (a reload boots purely from
   * the authoritative snapshot).
   */
  const [pendingLayoutHandoff, setPendingLayoutHandoff] = useState<PendingLayoutHandoff | null>(
    null
  );
  /**
   * A section to reveal on the NEXT DOM commit (create section, reorder,
   * delete-active). A ref — handlers set it synchronously around a
   * structural change, and the post-commit effect consumes it exactly
   * once so the instant scroll lands on the right element.
   */
  const pendingRevealRef = useRef<DesktopPageId | null>(null);

  const arrange = mode === "arrange";
  /** True only while a display layout outruns the durable snapshot. */
  const handoffLock = pendingLayoutHandoff !== null;

  const pageIds = useMemo(() => snapshot.pages.map((page) => page.id), [snapshot.pages]);
  const navigation = useSectionNavigation({
    pageIds,
    defaultPageId: snapshot.preferences.defaultPageId,
  });
  const { activePageId, scrollToSection } = navigation;

  /**
   * The active section as data. Derived FROM the scroll position — the
   * session never pins a page against it (the old sessionPageId is gone).
   */
  const activePage =
    activePageId !== null ? findDesktopPage(snapshot, activePageId) : undefined;

  /**
   * The rendered theme: the Settings preview while open, otherwise the
   * persisted appearance (legacy snapshots resolve to the Task013
   * defaults). This is the ONLY theme source — no component reads
   * appearance individually, everything inherits the CSS variables.
   */
  const resolvedAppearance = appearancePreview ?? resolveWorkspaceAppearance(snapshot.preferences);
  const theme = useMemo(() => buildAppearanceTheme(resolvedAppearance), [resolvedAppearance]);

  // The launcher index follows the live snapshot: a sync or edit landing
  // while the launcher is open recomputes the entries on the next render.
  const launcherEntries = useMemo(
    () =>
      buildLauncherEntries({
        workspace: snapshot,
        activePageId,
        mode,
        syncState: workspace.syncState,
        locale,
      }),
    [snapshot, activePageId, mode, workspace.syncState, locale],
  );

  const hasDock = useMemo(() => resolveDockEntities(snapshot).length > 0, [snapshot]);

  // Latest-value mirrors for async/session callbacks (drag commit, keyboard
  // navigation) that must always see the current render's data.
  const workspaceRef = useRef(workspace);
  const pageIdRef = useRef<DesktopPageId | null>(activePageId);
  const arrangeHistoriesRef = useRef(arrangeHistories);
  const selectionRef = useRef(selectedItemIds);
  const draggingRef = useRef(false);
  const lastDragEndedAtRef = useRef(0);
  const marqueeOriginRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const menuAreaRef = useRef<HTMLDivElement | null>(null);
  const layoutQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** Generation counter for drop handoffs — stale completions never win. */
  const handoffTokenRef = useRef(0);
  /** Imperative mirror of `pendingLayoutHandoff` for event handlers. */
  const pendingHandoffRef = useRef<PendingLayoutHandoff | null>(null);
  /** Handoffs whose stage attempt has settled (staged/noop/failed). */
  const settledHandoffTokensRef = useRef<ReadonlySet<number>>(new Set());
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  useEffect(() => {
    pageIdRef.current = activePageId;
  }, [activePageId]);
  useEffect(() => {
    arrangeHistoriesRef.current = arrangeHistories;
  }, [arrangeHistories]);

  function applySelection(next: ReadonlySet<LayoutItemId>) {
    selectionRef.current = next;
    setSelectedItemIds(next);
  }

  /** Establishes/clears the optimistic display layout, mirror ref included. */
  function stagePendingHandoff(next: PendingLayoutHandoff | null) {
    pendingHandoffRef.current = next;
    setPendingLayoutHandoff(next);
  }

  function switchMode(next: DesktopMode) {
    // A pending handoff means the display layout outruns the durable
    // snapshot — mode changes wait the few ms until the stage lands.
    if (pendingHandoffRef.current !== null) {
      return;
    }
    setMode(next);
    // Leaving arrange clears the session selection; re-entering arrange
    // starts fresh (the per-page history survives the round-trip).
    if (next === "view") {
      applySelection(EMPTY_SELECTION);
    }
  }

  /**
   * The active section moved (real scroll): the arrange selection belongs
   * to the section it was made on, so it never crosses sections.
   */
  const previousActiveRef = useRef<DesktopPageId | null>(activePageId);
  useEffect(() => {
    if (previousActiveRef.current !== activePageId) {
      previousActiveRef.current = activePageId;
      if (selectionRef.current.size > 0) {
        applySelection(EMPTY_SELECTION);
      }
    }
  }, [activePageId]);

  /** Reveal a section right after the DOM reflects a structural change. */
  useEffect(() => {
    const target = pendingRevealRef.current;
    if (target === null) {
      return;
    }
    pendingRevealRef.current = null;
    scrollToSection(target);
  }, [scrollToSection, snapshot.pages]);

  function openFolderOverlay(folderId: EntityId) {
    setFolderActionError(null);
    setOverlayFolderId(folderId);
  }

  function closeFolderOverlay() {
    setFolderActionError(null);
    setOverlayFolderId(null);
  }

  /**
   * Settings is the top surface: opening it clears any stale preview and
   * closes stray presentation state, but never stacks on top of another
   * modal (the keyboard guard and entry points keep it exclusive).
   */
  function openSettings() {
    setContextMenu(null);
    setAppearancePreview(null);
    setSettingsOpen(true);
  }

  /** Cancel/close: the preview dies with the surface, nothing was staged. */
  function closeSettings() {
    setAppearancePreview(null);
    setSettingsOpen(false);
  }

  /**
   * Settings save path: draft → full preferences → immutable domain edit →
   * local stage + sync attempt. The appearance persisted on success, so
   * the preview can be dropped without a theme flash-back. Staging
   * failures keep Settings open with the preview alive for correction.
   *
   * The scroll position stays untouched: a changed default section only
   * applies to the next session, never yanks the current view.
   */
  async function handleSettingsSave(draft: WorkspaceSettingsDraft): Promise<SettingsSaveResult> {
    const preferences = preferencesFromSettingsDraft(draft);
    const result = replaceWorkspacePreferences(snapshot, preferences);
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.reason === "default-page-not-found"
            ? t("settings.error.defaultPageGone")
            : t("settings.error.invalidAppearance"),
      };
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      console.error(`VelaDesk: settings were not staged (${staged.reason})`);
      return { ok: false, message: t("settings.error.saveFailed") };
    }
    setAppearancePreview(null);
    setSettingsOpen(false);
    return { ok: true };
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
   * Drop-handoff reconcile after every workspace snapshot change: once the
   * authoritative layout for the handoff's page is semantically equal to the
   * pending one, the override is dropped (pixel-identical hand-off). A
   * handoff whose stage attempt settled but whose page moved somewhere else
   * yields to the authoritative state; a page that vanished drops the
   * override outright. Settled tokens are pruned as their handoffs resolve.
   */
  useEffect(() => {
    const current = pendingLayoutHandoff;
    if (current === null) {
      return;
    }
    const page = findDesktopPage(snapshot, current.pageId);
    const next = reconcileHandoff(
      current,
      page,
      settledHandoffTokensRef.current.has(current.token)
    );
    if (next !== current) {
      const remaining = new Set(settledHandoffTokensRef.current);
      remaining.delete(current.token);
      settledHandoffTokensRef.current = remaining;
      stagePendingHandoff(next);
    }
  }, [snapshot, pendingLayoutHandoff]);

  /**
   * Serialized local-first layout commits: compute the candidate history,
   * stage the new snapshot, and only accept the candidate history after a
   * successful stage — a stage failure rolls the candidate back by never
   * accepting it into state.
   *
   * The optional `onSettled` callback reports the attempt's outcome exactly
   * once (staged / noop / failed) so the drag handoff can reconcile; the
   * callback never runs after a newer handoff replaced this one's token.
   */
  const enqueueLayoutCommit = useCallback(
    (
      pageId: DesktopPageId,
      movedLayout: PageLayout,
      onSettled?: (outcome: LayoutCommitOutcome) => void
    ) => {
      let settled = false;
      const settle = (outcome: LayoutCommitOutcome) => {
        if (!settled) {
          settled = true;
          onSettled?.(outcome);
        }
      };
      const run = async () => {
        try {
          const current = workspaceRef.current;
          const page = findDesktopPage(current.snapshot, pageId);
          if (page === undefined) {
            settle({ status: "noop" });
            return;
          }
          const base = arrangeHistoriesRef.current[pageId] ?? createLayoutHistory(page.layout);
          const candidate = commitLayout(base, movedLayout);
          if (candidate === base) {
            // Resolved back to the same layout: no semantic change, no
            // history entry, no staging.
            settle({ status: "noop" });
            return;
          }
          const replaced = replacePageLayout(current.snapshot, pageId, candidate.present);
          if (!replaced.ok) {
            settle({ status: "noop" });
            return;
          }
          const staged = await stageWorkspaceAndTrySync(runtime, replaced.workspace);
          if (!staged.ok) {
            console.error(`VelaDesk: layout change was not staged (${staged.reason})`);
            settle({ status: "failed" });
            return;
          }
          const nextMap: ArrangeHistories = {
            ...arrangeHistoriesRef.current,
            [pageId]: candidate,
          };
          arrangeHistoriesRef.current = nextMap;
          setArrangeHistories(nextMap);
          settle({ status: "staged" });
        } catch (error) {
          console.error("VelaDesk: layout change could not be committed", error);
          settle({ status: "failed" });
        }
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
      // No-op drop (dragged back to its own cell): no handoff, no stage, no
      // history, no sync — the drag simply ends where it began.
      if (arePageLayoutsEqual(movedLayout, layoutAtStart)) {
        return;
      }
      // Visual target first: the display grid shows the destination before
      // any IndexedDB promise is awaited, so the drop render paints straight
      // into the destination cell — the old authoritative layout never
      // becomes visible, and there is no origin rebound.
      const token = handoffTokenRef.current + 1;
      handoffTokenRef.current = token;
      stagePendingHandoff({ token, pageId, layout: movedLayout });
      // Durable local stage second; the outcome reconciles the handoff.
      enqueueLayoutCommit(pageId, movedLayout, (outcome) => {
        if (outcome.status === "failed") {
          // The only true revert: the stage refused, so the optimistic
          // display layout falls back to the authoritative (pre-drag) layout.
          if (pendingHandoffRef.current?.token === token) {
            settledHandoffTokensRef.current = new Set([
              ...settledHandoffTokensRef.current,
              token,
            ]);
            stagePendingHandoff(null);
          }
          return;
        }
        // staged/noop: not cleared here — the external-store snapshot may not
        // have caught up in the current render yet. The reconcile effect
        // drops the handoff once the authoritative layout is semantically
        // equal, making the pending → authoritative switch invisible.
        settledHandoffTokensRef.current = new Set([...settledHandoffTokensRef.current, token]);
      });
    },
    [enqueueLayoutCommit]
  );

  /** Undo/Redo: the resulting layout is a brand-new local edit. */
  const applyHistoryStep = useCallback(
    (pageId: DesktopPageId, direction: "undo" | "redo") => {
      // History rewrites geometry against the durable snapshot — never while
      // a display handoff still outruns it.
      if (pendingHandoffRef.current !== null) {
        return;
      }
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
      if (
        pageId === null ||
        selectionRef.current.size === 0 ||
        // Nudges compute against the durable snapshot — wait out any handoff.
        pendingHandoffRef.current !== null
      ) {
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

  /**
   * The layout the ACTIVE section renders this frame: the pending drop
   * handoff while it targets the active page, otherwise the authoritative
   * layout. Only the active section consumes it — persistence still flows
   * exclusively through the domain/runtime path.
   */
  const displayLayout =
    activePage !== undefined
      ? resolveDisplayLayout(pendingLayoutHandoff, activePage.id, activePage.layout)
      : null;

  const { gridRef, metrics } = useGridMetrics(
    displayLayout !== null ? displayLayout.grid : { columns: 1, rows: 1 }
  );
  const { dragging, handleDragStart, handleDragMove, handleDragEnd } = useAtomicGridDrag({
    layout: displayLayout,
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
      // A pending handoff means the durable snapshot is behind the display;
      // a second geometry session must not start on that base.
      if (pendingHandoffRef.current !== null) {
        return;
      }
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

  // --- Arrange marquee (rubber-band) selection, active section only -------
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
          applySelection(EMPTY_SELECTION);
        }
        return;
      }
      const viewport = menuAreaRef.current?.querySelector(
        '[data-active-section="true"] .vela-desktop__viewport'
      );
      if (viewport === null) {
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
        (viewport as HTMLElement).querySelectorAll<HTMLElement>("[data-item-id]"),
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

  // --- Context menu surface ----------------------------------------------
  // While anything modal/drag-ish is up, the real section stack must not
  // scroll (native CSS lock — no wheel parsing anywhere).
  const scrollLocked =
    dragging ||
    handoffLock ||
    settingsOpen ||
    launcherOpen ||
    dialog !== null ||
    contextMenu !== null ||
    overlayFolderId !== null;

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
      currentPageId !== null &&
      !draggingRef.current &&
      pendingHandoffRef.current === null;
    setContextMenu({
      x,
      y,
      entries: buildDesktopCommandEntries({
        t,
        arrange,
        canUndo:
          historyUsable && currentPageId !== null && canUndo(arrangeHistoriesRef.current, currentPageId),
        canRedo:
          historyUsable && currentPageId !== null && canRedo(arrangeHistoriesRef.current, currentPageId),
        syncState: workspace.syncState,
        callbacks: {
          onAddApp: () => openDialog({ kind: "add-app", pageId: pageDestination() }),
          onNewSection: () => openDialog({ kind: "new-section" }),
          onSearch: () => setLauncherOpen(true),
          onToggleMode: () => switchMode(arrange ? "view" : "arrange"),
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
          onRefresh: () => void runtime.pullCurrent(),
          onOpenSettings: openSettings,
          onToggleLocale: () => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN"),
        },
      }),
    });
  }

  function openEntityMenu(entityId: EntityId, x: number, y: number) {
    const entity = snapshot.entities.find((candidate) => candidate.id === entityId);
    if (entity === undefined) {
      setContextMenu({ x, y, entries: [] });
      return;
    }
    const pinned = snapshot.dock.items.includes(entity.id);
    let entries: readonly DesktopMenuEntry[];
    if (entity.kind === "app") {
      entries = buildAppMenuEntries({
        t,
        pinned,
        callbacks: {
          onOpen: () => launchApp(entity),
          onEdit: () => openDialog({ kind: "edit-app", entityId: entity.id }),
          onEditAppearance: () => openDialog({ kind: "edit-visual", entityId: entity.id }),
          onMoveToSection: () => openDialog({ kind: "move-to-section", appId: entity.id }),
          onPinToggle: () =>
            void runDockEdit((input) =>
              pinned ? unpinEntityFromDock(input, entity.id) : pinEntityToDock(input, entity.id)
            ),
          onDelete: () => openDialog({ kind: "delete-app", entityId: entity.id }),
        },
      });
    } else if (entity.kind === "folder") {
      entries = buildFolderMenuEntries({
        t,
        pinned,
        callbacks: {
          onOpen: () => openFolderOverlay(entity.id),
          onRename: () => openDialog({ kind: "rename-folder", folderId: entity.id }),
          onPinToggle: () =>
            void runDockEdit((input) =>
              pinned ? unpinEntityFromDock(input, entity.id) : pinEntityToDock(input, entity.id)
            ),
          onDissolve: () => openDialog({ kind: "delete-folder", folderId: entity.id }),
        },
      });
    } else {
      // Widgets are not editable in this stage — one quiet row.
      entries = [
        { kind: "action", id: "widget-later", label: t("menu.widgetLater"), disabled: true, onSelect: () => {} },
      ];
    }
    setContextMenu({ x, y, entries });
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
        isEmpty: page.layout.items.length === 0,
        callbacks: {
          onRename: () => openDialog({ kind: "rename-section", pageId }),
          onSetDefault: () =>
            void runSectionEdit(setDefaultPage(snapshot, pageId), null),
          onMoveUp: () => void runSectionEdit(movePage(snapshot, pageId, "up"), pageId),
          onMoveDown: () => void runSectionEdit(movePage(snapshot, pageId, "down"), pageId),
          onDelete: () => openDialog({ kind: "delete-section", pageId }),
        },
      }),
    });
  }

  function pageDestination(): DesktopPageId {
    return activePageId ?? snapshot.pages[0]?.id ?? "page";
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
   * Launcher activation orchestration: entries are pure data, the shell
   * resolves them against the live snapshot (a stale entry can no longer
   * launch). Section results scroll the REAL stack — never a direct
   * active-state write.
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
        scrollToSection(entry.pageId);
        return;
      case "command":
        activateLauncherCommand(entry.commandId);
        return;
    }
  }

  function activateLauncherCommand(commandId: LauncherCommandId) {
    switch (commandId) {
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
        switchMode(arrange ? "view" : "arrange");
        return;
      case "sync-current":
        void runtime.syncCurrent();
        return;
      case "pull-current":
        void runtime.pullCurrent();
        return;
    }
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
      // The DOM order changed; the very next commit scrolls back to the
      // SAME section so the user never sees a neighbor flash by.
      pendingRevealRef.current = revealPageId;
    }
  }

  async function handleDeleteSection(pageId: DesktopPageId) {
    // Decide the surviving neighbor BEFORE the deletion so the scroll can
    // never land on an index that no longer exists.
    const neighbor = resolveSectionAfterDelete(pageIds, pageId);
    const result = deleteEmptyPage(snapshot, pageId);
    if (!result.ok) {
      setDialogError(
        result.reason === "page-not-found"
          ? t("dialog.deleteSection.error.sectionGone")
          : t("dialog.deleteSection.error.failed")
      );
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setDialogError(t("dialog.deleteSection.error.failed"));
      return;
    }
    closeDialog();
    if (neighbor !== null) {
      pendingRevealRef.current = neighbor;
    }
  }

  async function handleDeleteApp(appId: EntityId) {
    const result = deleteApp(snapshot, appId);
    if (!result.ok) {
      setDialogError(t("dialog.deleteApp.error.appGone"));
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setDialogError(t("dialog.deleteApp.error.failed"));
      return;
    }
    closeDialog();
  }

  async function handleDissolveFolder(folderId: EntityId) {
    const pageId = activePageId;
    if (pageId === null) {
      setDialogError(t("dialog.deleteFolder.error.noActivePage"));
      return;
    }
    const result = dissolveFolderToPage(snapshot, folderId, pageId);
    if (!result.ok) {
      setDialogError(
        result.reason === "no-space"
          ? t("dialog.deleteFolder.error.noSpace")
          : t("dialog.deleteFolder.error.folderGone")
      );
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setDialogError(t("dialog.deleteFolder.error.failed"));
      return;
    }
    if (overlayFolderId === folderId) {
      closeFolderOverlay();
    }
    closeDialog();
  }

  // Keyboard: undo/redo, select all, launcher chord, Escape selection
  // clear, arrow nudge, then — lowest priority — real-scroll section nav.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const inField =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const surfaceOpen =
        contextMenu !== null ||
        dialog !== null ||
        overlayFolderId !== null ||
        launcherOpen ||
        settingsOpen;

      if (event.key === "Escape") {
        // Open surfaces consume Escape themselves; otherwise it clears the
        // session selection.
        if (!surfaceOpen && arrange && selectionRef.current.size > 0) {
          event.preventDefault();
          applySelection(EMPTY_SELECTION);
        }
        return;
      }

      // Launcher chord: Ctrl/Cmd+K toggles the launcher, but never steals
      // the chord from another modal surface or an in-flight drag (and the
      // launcher never nests on top of one).
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        if (launcherOpen) {
          event.preventDefault();
          setLauncherOpen(false);
          return;
        }
        if (surfaceOpen || draggingRef.current) {
          return;
        }
        event.preventDefault();
        setLauncherOpen(true);
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
        // A pending handoff makes undo/redo unavailable for the moment,
        // leaving the chord untouched for the browser/OS.
        const historyAvailable = pendingHandoffRef.current === null;
        const command = resolveArrangeHistoryCommand({
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          canUndo:
            pageId !== null && historyAvailable && canUndo(arrangeHistoriesRef.current, pageId),
          canRedo:
            pageId !== null && historyAvailable && canRedo(arrangeHistoriesRef.current, pageId),
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
      if (
        isArrow &&
        arrange &&
        !surfaceOpen &&
        !draggingRef.current &&
        pendingHandoffRef.current === null &&
        selectionRef.current.size > 0
      ) {
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

      // Section keyboard navigation — the LOWEST priority: only when no
      // input owns the event, no surface is open, nothing drags, and the
      // arrange selection does not own the arrows. Scrolls the REAL stack;
      // no wrap at either end.
      if (dragging || surfaceOpen || pendingHandoffRef.current !== null) {
        return;
      }
      if (arrange && selectionRef.current.size > 0) {
        return;
      }
      const sectionKey = sectionNavDirection(event.key);
      if (sectionKey === null) {
        return;
      }
      const pages = workspaceRef.current.snapshot.pages;
      const currentId = pageIdRef.current;
      if (pages.length < 2 || currentId === null) {
        return;
      }
      const neighborId =
        sectionKey === "prev"
          ? previousSectionId(pages.map((page) => page.id), currentId)
          : nextSectionId(pages.map((page) => page.id), currentId);
      if (neighborId !== null) {
        event.preventDefault();
        scrollToSection(neighborId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [arrange, contextMenu, dialog, overlayFolderId, launcherOpen, settingsOpen, dragging, activePage, nudgeSelection, applyHistoryStep, scrollToSection]);

  /**
   * Empty-desktop right-click → the VelaDesk command menu. Text fields and
   * anything opted in via data-vd-native-context-menu keep the BROWSER
   * menu (copy/paste/spellcheck) — there is no global suppressor.
   */
  function handleAreaContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable ||
      target.closest("[data-vd-native-context-menu='true']") !== null
    ) {
      return;
    }
    event.preventDefault();
    openDesktopCommandMenu(event.clientX, event.clientY);
  }

  if (activePage === undefined && pageIds.length === 0) {
    // Invariant violation (a workspace always has pages) — stay calm, stay
    // inspectable, never crash the tab.
    return (
      <main className="vela-screen">
        <div className="vela-screen__ambient" aria-hidden="true" />
        <section className="vela-screen__panel">
          <h1 className="vela-wordmark">VelaDesk</h1>
          <p className="vela-screen__lead">{t("recovery.noPages")}</p>
          <button
            type="button"
            className="vela-button"
            onClick={() => window.location.reload()}
          >
            {t("common.retry")}
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

  return (
    <div
      className="vela-desktop"
      data-arrange={arrange ? "true" : "false"}
      data-vd-color-mode={theme.colorMode}
      data-vd-wallpaper={theme.wallpaperPreset}
      data-has-dock={hasDock ? "true" : "false"}
      style={theme.style as CSSProperties}
    >
      <DragDropProvider
        onDragStart={wrappedHandleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={wrappedHandleDragEnd}
      >
        <StaticDropFeedback />
        <div className="vela-desktop__menu-area" ref={menuAreaRef}>
          <div
            className="vela-desktop__area-shell"
            onContextMenu={handleAreaContextMenu}
          >
            {/*
              The one real scroll container: native CSS scroll-snap paging,
              no wheel listeners, no JS physics. While a modal or a drag is
              up, data-scroll-locked freezes it without changing scrollTop.
            */}
            <div
              className="vela-section-stack"
              ref={navigation.stackRef}
              data-scroll-locked={scrollLocked ? "true" : undefined}
            >
              {pages.map((page) => {
                const isActive = page.id === activePageId;
                return (
                  <section
                    key={page.id}
                    ref={navigation.registerSection(page.id)}
                    data-page-id={page.id}
                    data-active-section={isActive ? "true" : undefined}
                    className="vela-section"
                  >
                    <DesktopGridView
                      layout={isActive && displayLayout !== null ? displayLayout : page.layout}
                      workspace={snapshot}
                      arrange={arrange && isActive}
                      dragEnabled={arrange && isActive && !handoffLock}
                      metrics={isActive ? metrics : null}
                      gridRef={isActive ? gridRef : undefined}
                      selectedIds={isActive ? selectedItemIds : EMPTY_SELECTION}
                      onItemSelect={handleItemSelect}
                      onEntityContextMenu={(entityId, x, y) =>
                        openContextMenu({ kind: "entity", entityId, source: "desktop", x, y })
                      }
                      onOpenFolder={(folderId) => openFolderOverlay(folderId)}
                      onViewportPointerDown={
                        isActive ? handleViewportPointerDown : undefined
                      }
                      onViewportPointerMove={
                        isActive ? handleViewportPointerMove : undefined
                      }
                      onViewportPointerUp={isActive ? handleViewportPointerUp : undefined}
                    />
                  </section>
                );
              })}
            </div>
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

      <SectionNavigation
        pages={pages}
        activePageId={activePageId}
        onSelectSection={scrollToSection}
        onSectionContextMenu={(pageId, x, y) => openContextMenu({ kind: "section", pageId, x, y })}
        onOpenCommandMenu={(x, y) => openContextMenu({ kind: "desktop", x, y })}
        footer={<SectionSyncStatus workspace={workspace} lastRemoteResult={lastRemoteResult} />}
      />

      <Dock
        workspace={snapshot}
        onOpenFolder={(folderId) => openFolderOverlay(folderId)}
        onEntityContextMenu={(entityId, x, y) =>
          openContextMenu({ kind: "entity", entityId, source: "dock", x, y })
        }
        onDesktopContextMenu={(x, y) => openContextMenu({ kind: "desktop", x, y })}
      />

      {overlayFolder !== undefined ? (
        <FolderOverlay
          folder={overlayFolder}
          workspace={snapshot}
          error={folderActionError ?? undefined}
          onClose={closeFolderOverlay}
          onLaunchApp={launchApp}
          onChildContextMenu={(entityId, x, y) =>
            openContextMenu({ kind: "entity", entityId, source: "folder", x, y })
          }
        />
      ) : null}

      {dialog !== null && dialog.kind === "add-app" ? (
        <AddAppDialog
          workspace={snapshot}
          destination={{ kind: "page", pageId: dialog.pageId }}
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
      {dialog !== null && dialog.kind === "edit-visual" ? (
        <AppVisualEditor
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
      {dialog !== null && (dialog.kind === "new-section" || dialog.kind === "rename-section") ? (
        <SectionDialog
          workspace={snapshot}
          gridSourcePage={activePage ?? pages[0]!}
          section={
            dialog.kind === "rename-section"
              ? findDesktopPage(snapshot, dialog.pageId)
              : undefined
          }
          onCreated={(pageId) => {
            pendingRevealRef.current = pageId;
          }}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "delete-section" ? (
        <ConfirmDialog
          title={t("dialog.deleteSection.title")}
          message={t("dialog.deleteSection.message")}
          confirmLabel={t("dialog.deleteSection.confirm")}
          error={dialogError}
          onConfirm={() => void handleDeleteSection(dialog.pageId)}
          onCancel={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "move-to-section" ? (
        <MoveToSectionDialog
          workspace={snapshot}
          appId={dialog.appId}
          currentPageId={containerPageId(snapshot, dialog.appId)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "rename-folder" ? (
        <FolderDialog
          workspace={snapshot}
          pageId={activePageId ?? pages[0]!.id}
          folder={findFolderEntity(snapshot, dialog.folderId)}
          onClose={closeDialog}
        />
      ) : null}
      {dialog !== null && dialog.kind === "delete-folder" ? (
        <ConfirmDialog
          title={t("dialog.deleteFolder.title")}
          message={t("dialog.deleteFolder.message")}
          confirmLabel={t("dialog.deleteFolder.confirm")}
          error={dialogError}
          onConfirm={() => void handleDissolveFolder(dialog.folderId)}
          onCancel={closeDialog}
        />
      ) : null}

      {contextMenu !== null ? (
        <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      ) : null}

      {launcherOpen ? (
        <Launcher
          entries={launcherEntries}
          onActivate={activateLauncherEntry}
          onClose={() => setLauncherOpen(false)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsCenter
          workspace={snapshot}
          onPreviewAppearance={setAppearancePreview}
          onSave={handleSettingsSave}
          onClose={closeSettings}
        />
      ) : null}
    </div>
  );
}

/**
 * Mounts inside the DragDropProvider and configures its manager once:
 * decorative drop animation off (official Feedback#dropAnimation = null),
 * so an arrange drop paints straight into its snapped cell and stays
 * still. See dnd-static-drop.ts for the product rationale.
 */
function StaticDropFeedback() {
  const manager = useDragDropManager();
  useEffect(() => {
    if (manager !== null) {
      disableDndDropAnimation(manager);
    }
  }, [manager]);
  return null;
}

function findFolderEntity(
  workspace: WorkspaceSnapshot,
  folderId: EntityId
): Folder | undefined {
  const entity = workspace.entities.find((candidate) => candidate.id === folderId);
  return entity !== undefined && entity.kind === "folder" ? entity : undefined;
}

/** The page whose layout currently holds this entity, when any. */
function containerPageId(
  workspace: WorkspaceSnapshot,
  entityId: EntityId
): DesktopPageId | null {
  const page = workspace.pages.find((candidate) =>
    candidate.layout.items.some((item) => item.id === entityId)
  );
  return page?.id ?? null;
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
  const { t } = useI18n();
  const app = workspace.entities.find(
    (entity): entity is AppShortcut => entity.kind === "app" && entity.id === appId
  );
  return (
    <ConfirmDialog
      title={t("dialog.deleteApp.title", { name: app?.name ?? t("launcher.kind.app") })}
      message={t("dialog.deleteApp.message")}
      confirmLabel={t("dialog.deleteApp.confirm")}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
