"use client";

import { DragDropProvider, useDragDropManager } from "@dnd-kit/react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  areCanvasLayoutsEqual,
  canvasCellSize,
  canConvertGridToFreeform,
  canvasRectToGridGeometry,
  gridLayoutToFreeform,
  replaceCanvasItem,
  replaceGridItem,
  translateCanvasItems,
  translateGridItems,
} from "@veladesk/canvas-engine";
import type { CanvasRect, PagePlacementMode } from "@veladesk/canvas-engine";
import type { PagePlacement } from "@veladesk/domain";
import {
  deleteApp,
  deleteEmptyPage,
  dissolveFolderToPage,
  findDesktopPage,
  movePage,
  pageItemIds,
  pinEntityToDock,
  replacePageCanvas,
  replaceWorkspacePreferences,
  resolveGridGapPx,
  resolvePagePlacement,
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
import type { LayoutItemId } from "@veladesk/desktop-engine";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../workspace-runtime/use-workspace-runtime";
import { resolveDragItemIds } from "../desktop-grid/group-drag";
import { useCanvasDrag } from "../canvas/use-canvas-drag";
import { useCanvasMetrics } from "../canvas/use-canvas-metrics";
import { useSquareGridMetrics } from "../canvas/use-square-grid-metrics";
import type { ResizeCommitGeometry } from "../canvas/canvas-resize";
import {
  reconcileCanvasHandoff,
  resolveDisplayPlacement,
} from "../canvas/canvas-handoff";
import type { PendingCanvasHandoff } from "../canvas/canvas-handoff";
import {
  canRedo,
  canUndo,
  commitPageCanvas,
  reconcilePageCanvasHistory,
  redoPageCanvas,
  resetPageCanvasHistory,
  undoPageCanvas,
} from "../canvas/arrange-history";
import type { ArrangeCanvasHistories } from "../canvas/arrange-history";
import { ContextMenu } from "./context-menu";
import type { ContextMenuState } from "./context-menu";
import { AddAppDialog } from "./add-app-dialog";
import { AppVisualEditor } from "./app-visual-editor";
import { resolveArrangeHistoryCommand } from "./arrange-shortcuts";
import { ArrangeToolbar } from "./arrange-toolbar";
import { ConfirmDialog } from "./confirm-dialog";
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
import { SectionRail } from "./section-rail";
import { SectionSyncStatus } from "./section-sync-status";
import { SectionView } from "./section-view";
import { SectionScrollMemory } from "./section-scroll-memory";
import { normalizeSelection, selectAllIds, toggleSelection } from "./selection-state";
import { normalizeSelectionRect, selectIntersectingItemIds } from "./selection-geometry";
import { resolveSectionAfterDelete } from "./section-navigation-model";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { launchApp } from "./launch-app";
import { buildAppearanceTheme } from "./appearance-theme";
import { disableDndDropAnimation } from "./dnd-static-drop";
import { useI18n } from "../i18n/use-i18n";
import { Launcher } from "./launcher";
import { buildLauncherEntries } from "./launcher-index";
import type { LauncherCommandId, LauncherEntry } from "./launcher-types";
import { SettingsCenter } from "./settings-center";
import type { SettingsSaveResult } from "./settings-center";
import { preferencesFromSettingsDraft } from "./settings-draft";
import type { WorkspaceSettingsDraft } from "./settings-draft";
import "./home-shell.css";

/** UI-only desktop mode. Session state — never persisted back to preferences. */
export type DesktopMode = "view" | "arrange";

/**
 * Which context-menu surface was opened. Presentation-only shell state.
 * The desktop command menu (empty area / rail chrome) is built by
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

/** Section transition duration — must match the CSS keyframes. */
const SECTION_TRANSITION_MS = 190;

const EMPTY_SELECTION: ReadonlySet<LayoutItemId> = new Set();
const EMPTY_ID_SET: ReadonlySet<EntityId> = new Set();

interface DesktopShellProps {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
}

/** One section currently animating out of the viewport. */
interface SectionExit {
  readonly pageId: DesktopPageId;
  readonly token: number;
  readonly towards: "next" | "prev";
}

/**
 * The ready-state production desktop (task 017): a real two-column
 * workspace — a fixed left section rail (titles only) and a right workspace
 * that owns the active section's independent content scrolling.
 *
 * The ACTIVE SECTION is explicit session state (never scroll-position
 * derived); switching sections plays a whole-page vertical transition and
 * remembers each section's scrollTop in session state. Sections place
 * their items in Grid (responsive square cells, unbounded rows) or Freeform
 * (continuous rects) mode, resolved through the domain's canonical v2
 * placement resolver. Local-first editing: every edit runs a pure
 * operation, stages the resulting snapshot immediately, then fires an
 * explicit sync. Arrange mode belongs to the ACTIVE section only —
 * selection, drags, nudges and the per-page history never cross sections.
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
  const [arrangeHistories, setArrangeHistories] = useState<ArrangeCanvasHistories>({});
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * Session-only live preview from the Settings Center. It never stages or
   * syncs; it is dropped on Cancel and on a successful Save (the persisted
   * snapshot then carries the same appearance, so no flash-back).
   */
  const [appearancePreview, setAppearancePreview] = useState<WorkspaceAppearancePreferences | null>(null);
  /**
   * Session-only optimistic display canvas for a just-committed geometry
   * edit (drag drop, resize, mode switch). It is established synchronously
   * at release time — before any IndexedDB promise is awaited — so the
   * section shows the geometry the user produced the moment the pointer
   * lets go, and the authoritative snapshot catches up invisibly a few
   * frames later. Presentation state only: it never touches the
   * WorkspaceSnapshot, IndexedDB, the server or localStorage, and dies with
   * the session (a reload boots purely from the authoritative snapshot).
   */
  const [pendingCanvasHandoff, setPendingCanvasHandoff] = useState<PendingCanvasHandoff | null>(null);
  /**
   * The app whose resize session is live right now. A live session locks
   * every competing gesture (drag, marquee, nudge, undo/redo, mode and
   * section switches) for as long as it lasts.
   */
  const [resizeSessionAppId, setResizeSessionAppId] = useState<EntityId | null>(null);
  /**
   * The ACTIVE section as explicit session state (task 017). The right
   * workspace renders exactly this section's scroller; nothing is derived
   * from scroll positions anymore.
   */
  const [activePageId, setActivePageId] = useState<DesktopPageId | null>(() =>
    snapshot.pages.some((page) => page.id === snapshot.preferences.defaultPageId)
      ? snapshot.preferences.defaultPageId
      : (snapshot.pages[0]?.id ?? null)
  );
  /** The section currently animating out, unmounted when it settles. */
  const [sectionExit, setSectionExit] = useState<SectionExit | null>(null);
  /**
   * Session-only preview of a just-clicked toolbar gap change — applies to
   * the visual grid immediately while the durable preference stage lands.
   */
  const [pendingGapPx, setPendingGapPx] = useState<number | null>(null);

  const arrange = mode === "arrange";
  /** True only while a display canvas outruns the durable snapshot. */
  const handoffLock = pendingCanvasHandoff !== null;
  /**
   * True while a rect resize owns the desktop. The lock is deliberately
   * short — it ends the moment the gesture finishes, never waiting for a
   * server sync.
   */
  const resizeLock = resizeSessionAppId !== null;
  /** The app whose resize is live. */
  const resizeActiveId = resizeSessionAppId;

  const pageIds = useMemo(() => snapshot.pages.map((page) => page.id), [snapshot.pages]);

  /**
   * The effective active section: the explicit state while it still exists,
   * otherwise the default section, otherwise the first — derived so
   * structural changes (delete) reconcile within one render.
   */
  const effectiveActivePageId = useMemo(() => {
    if (activePageId !== null && pageIds.includes(activePageId)) {
      return activePageId;
    }
    if (pageIds.includes(snapshot.preferences.defaultPageId)) {
      return snapshot.preferences.defaultPageId;
    }
    return pageIds[0] ?? null;
  }, [activePageId, pageIds, snapshot.preferences.defaultPageId]);

  const activePage =
    effectiveActivePageId !== null
      ? findDesktopPage(snapshot, effectiveActivePageId)
      : undefined;

  /**
   * The rendered theme: the Settings preview while open, otherwise the
   * persisted appearance (legacy snapshots resolve to the Task013
   * defaults). This is the ONLY theme source — no component reads
   * appearance individually, everything inherits the CSS variables.
   */
  const resolvedAppearance = appearancePreview ?? resolveWorkspaceAppearance(snapshot.preferences);
  const theme = useMemo(() => buildAppearanceTheme(resolvedAppearance), [resolvedAppearance]);

  /** The persisted gap, resolved for legacy snapshots. */
  const persistedGapPx = useMemo(() => resolveGridGapPx(snapshot.preferences), [snapshot.preferences]);
  /**
   * The effective grid gap: a just-clicked toolbar change previews until the
   * durable snapshot carries the same value (derived in render, never an
   * effect — a caught-up preview and the persisted value are identical, so
   * the switch is invisible).
   */
  const displayGapPx =
    pendingGapPx !== null && pendingGapPx !== persistedGapPx ? pendingGapPx : persistedGapPx;

  // The launcher index follows the live snapshot: a sync or edit landing
  // while the launcher is open recomputes the entries on the next render.
  const launcherEntries = useMemo(
    () =>
      buildLauncherEntries({
        workspace: snapshot,
        activePageId: effectiveActivePageId,
        mode,
        syncState: workspace.syncState,
        locale,
      }),
    [snapshot, effectiveActivePageId, mode, workspace.syncState, locale],
  );

  const hasDock = useMemo(() => resolveDockEntities(snapshot).length > 0, [snapshot]);

  // Latest-value mirrors for async/session callbacks (drag commit, keyboard
  // navigation) that must always see the current render's data.
  const workspaceRef = useRef(workspace);
  const pageIdRef = useRef<DesktopPageId | null>(effectiveActivePageId);
  const arrangeHistoriesRef = useRef(arrangeHistories);
  const selectionRef = useRef(selectedItemIds);
  const draggingRef = useRef(false);
  const lastDragEndedAtRef = useRef(0);
  const marqueeOriginRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const menuAreaRef = useRef<HTMLDivElement | null>(null);
  const layoutQueueRef = useRef<Promise<void>>(Promise.resolve());
  /** Generation counter for canvas handoffs — stale completions never win. */
  const handoffTokenRef = useRef(0);
  /** Imperative mirror of `pendingCanvasHandoff` for event handlers. */
  const pendingHandoffRef = useRef<PendingCanvasHandoff | null>(null);
  /** Handoffs whose stage attempt has settled (staged/noop/failed). */
  const settledHandoffTokensRef = useRef<ReadonlySet<number>>(new Set());
  /**
   * Imperative mirror of the resize lock. Gesture handlers are created once
   * and read this ref, so a session started mid-render still blocks them.
   */
  const resizeLockRef = useRef(false);
  /** Per-section scroll memory (session only, never persisted). */
  const scrollMemoryRef = useRef(new SectionScrollMemory());
  /** The live scroller element of the ACTIVE section view. */
  const activeScrollerRef = useRef<HTMLDivElement | null>(null);
  /** Timestamp of the last section switch — rapid input skips exit animations. */
  const lastSectionSwitchAtRef = useRef(0);
  /** Generation counter for section exits — a stale timer never clears a newer one. */
  const sectionExitTokenRef = useRef(0);
  /**
   * A section to reveal on the NEXT commit (create section, reorder,
   * delete-active). A ref — handlers set it synchronously around a
   * structural change, and the post-commit effect consumes it exactly
   * once so the instant switch lands on the right section.
   */
  const pendingRevealRef = useRef<DesktopPageId | null>(null);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);
  useEffect(() => {
    pageIdRef.current = effectiveActivePageId;
  }, [effectiveActivePageId]);
  useEffect(() => {
    arrangeHistoriesRef.current = arrangeHistories;
  }, [arrangeHistories]);
  useEffect(() => {
    resizeLockRef.current = resizeLock;
  }, [resizeLock]);

  function applySelection(next: ReadonlySet<LayoutItemId>) {
    selectionRef.current = next;
    setSelectedItemIds(next);
  }

  /** Establishes/clears the optimistic display canvas, mirror ref included. */
  function stagePendingHandoff(next: PendingCanvasHandoff | null) {
    pendingHandoffRef.current = next;
    setPendingCanvasHandoff(next);
  }

  function switchMode(next: DesktopMode) {
    // A pending handoff means the display canvas outruns the durable
    // snapshot — mode changes wait the few ms until the stage lands. A live
    // resize owns the desktop entirely.
    if (pendingHandoffRef.current !== null || resizeLockRef.current) {
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
   * The active section moved: the arrange selection belongs to the section
   * it was made on, so it never crosses sections.
   */
  const previousActiveRef = useRef<DesktopPageId | null>(effectiveActivePageId);
  useEffect(() => {
    if (previousActiveRef.current !== effectiveActivePageId) {
      previousActiveRef.current = effectiveActivePageId;
      if (selectionRef.current.size > 0) {
        applySelection(EMPTY_SELECTION);
      }
    }
  }, [effectiveActivePageId]);

  /**
   * Section switching with the whole-page vertical transition.
   *
   * Before leaving, the section's scrollTop is remembered; the entering
   * view restores it on mount. A rapid second switch (before the first
   * transition settled) unmounts the old view immediately instead of
   * stacking exits — navigation stays deterministic under burst input.
   */
  const switchSection = useCallback(
    (pageId: DesktopPageId, options: { readonly animate?: boolean } = {}) => {
      const currentId = pageIdRef.current;
      if (pageId === currentId || currentId === null) {
        return;
      }
      if (resizeLockRef.current) {
        // A live resize owns the desktop: switching would unmount the tile
        // (and its pointer capture) out from under the user.
        return;
      }

      const pages = workspaceRef.current.snapshot.pages;
      const currentIndex = pages.findIndex((page) => page.id === currentId);
      const nextIndex = pages.findIndex((page) => page.id === pageId);
      if (nextIndex < 0) {
        return;
      }
      const towards: "next" | "prev" = nextIndex > currentIndex ? "next" : "prev";

      // Remember the outgoing section's scroll position (session only).
      const scroller = activeScrollerRef.current;
      if (scroller !== null) {
        scrollMemoryRef.current.save(currentId, scroller.scrollTop);
      }

      const previousSwitchAt = lastSectionSwitchAtRef.current;
      lastSectionSwitchAtRef.current = Date.now();
      setActivePageId(pageId);

      const animate = options.animate !== false;
      const rapid = Date.now() - previousSwitchAt < SECTION_TRANSITION_MS + 40;
      if (!animate || rapid) {
        // Instant swap: drop any exit immediately.
        sectionExitTokenRef.current += 1;
        setSectionExit(null);
        return;
      }

      const token = sectionExitTokenRef.current + 1;
      sectionExitTokenRef.current = token;
      setSectionExit({ pageId: currentId, token, towards });
      window.setTimeout(() => {
        if (sectionExitTokenRef.current === token) {
          setSectionExit((current) =>
            current !== null && current.token === token ? null : current
          );
        }
      }, SECTION_TRANSITION_MS);
    },
    []
  );

  /**
   * Reveal a section right after a structural change (create/reorder/
   * delete-active) — instantly, so the viewport never glides past neighbors.
   */
  useEffect(() => {
    const target = pendingRevealRef.current;
    if (target === null) {
      return;
    }
    pendingRevealRef.current = null;
    switchSection(target, { animate: false });
  }, [switchSection, snapshot.pages]);

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
   * The active section stays untouched: a changed default section only
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
            : result.reason === "invalid-grid-gap"
              ? t("settings.error.invalidGridGap")
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

  /**
   * One completed toolbar gap change: preview immediately, persist once.
   * The preview clears once the authoritative snapshot carries the same
   * gap; a failed stage drops it (the visual grid returns to the persisted
   * value — an honest revert).
   */
  const handleGridGapChange = useCallback(
    (gapPx: number) => {
      setPendingGapPx(gapPx);
      const run = async () => {
        const current = workspaceRef.current;
        const replaced = replaceWorkspacePreferences(current.snapshot, {
          ...current.snapshot.preferences,
          gridGapPx: gapPx,
        });
        if (!replaced.ok) {
          console.error(`VelaDesk: grid gap change refused (${replaced.reason})`);
          setPendingGapPx(null);
          return;
        }
        const staged = await stageWorkspaceAndTrySync(runtime, replaced.workspace);
        if (!staged.ok) {
          console.error(`VelaDesk: grid gap change was not staged (${staged.reason})`);
          setPendingGapPx(null);
        }
      };
      layoutQueueRef.current = layoutQueueRef.current.then(run, run);
    },
    [runtime]
  );

  /** Selection + history reconcile after every workspace/active-page change. */
  useEffect(() => {
    if (activePage === undefined) {
      return;
    }
    const validIds = new Set(pageItemIds(activePage));
    const normalized = normalizeSelection(selectionRef.current, validIds);
    if (normalized !== selectionRef.current) {
      applySelection(normalized);
    }
    setArrangeHistories((current) =>
      reconcilePageCanvasHistory(current, activePage.id, resolvePagePlacement(activePage)),
    );
  }, [activePage]);

  /**
   * Handoff reconcile after every workspace snapshot change: once the
   * authoritative placement for the handoff's page is semantically equal to
   * the pending one, the override is dropped (pixel-identical hand-off). A
   * handoff whose stage attempt settled but whose page moved somewhere else
   * yields to the authoritative state, and a page that vanished drops the
   * override outright. Settled tokens are pruned as their handoffs resolve.
   */
  useEffect(() => {
    const current = pendingCanvasHandoff;
    if (current === null) {
      return;
    }
    const page = findDesktopPage(snapshot, current.pageId);
    const next = reconcileCanvasHandoff(
      current,
      page === undefined ? undefined : resolvePagePlacement(page),
      settledHandoffTokensRef.current.has(current.token)
    );
    if (next !== current) {
      const remaining = new Set(settledHandoffTokensRef.current);
      remaining.delete(current.token);
      settledHandoffTokensRef.current = remaining;
      stagePendingHandoff(next);
    }
  }, [snapshot, pendingCanvasHandoff]);

  /**
   * Serialized local-first canvas commits: stage the new snapshot, and only
   * accept the history step after a successful stage — a stage failure rolls
   * the step back by never accepting it into state.
   *
   * The optional `onSettled` callback reports the attempt's outcome exactly
   * once (staged / noop / failed) so a handoff can reconcile; the callback
   * never runs after a newer handoff replaced this one's token.
   *
   * `resetHistory` marks the structural edits that are deliberately NOT
   * undoable (placement-mode switch): the page branch restarts at the new
   * placement so undo can never walk back into a model the user left.
   */
  const enqueueCanvasCommit = useCallback(
    (
      pageId: DesktopPageId,
      nextPlacement: PagePlacement,
      options: { readonly resetHistory?: boolean } = {},
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
          if (areCanvasLayoutsEqual(resolvePagePlacement(page), nextPlacement)) {
            // Resolved back to the same geometry: no stage, no history
            // entry, no sync.
            settle({ status: "noop" });
            return;
          }
          const replaced = replacePageCanvas(current.snapshot, pageId, nextPlacement);
          if (!replaced.ok) {
            settle({ status: "noop" });
            return;
          }
          const staged = await stageWorkspaceAndTrySync(runtime, replaced.workspace);
          if (!staged.ok) {
            console.error(`VelaDesk: canvas change was not staged (${staged.reason})`);
            settle({ status: "failed" });
            return;
          }
          const nextMap: ArrangeCanvasHistories =
            options.resetHistory === true
              ? resetPageCanvasHistory(arrangeHistoriesRef.current, pageId, nextPlacement)
              : commitPageCanvas(arrangeHistoriesRef.current, pageId, nextPlacement);
          arrangeHistoriesRef.current = nextMap;
          setArrangeHistories(nextMap);
          settle({ status: "staged" });
        } catch (error) {
          console.error("VelaDesk: canvas change could not be committed", error);
          settle({ status: "failed" });
        }
      };
      layoutQueueRef.current = layoutQueueRef.current.then(run, run);
    },
    [runtime]
  );

  /**
   * Commits one canvas geometry edit with the optimistic handoff: the
   * display canvas shows the result before any IndexedDB promise is awaited,
   * so the release render paints into the new geometry and the authoritative
   * snapshot never becomes visible in between.
   */
  const commitCanvasEdit = useCallback(
    (
      pageId: DesktopPageId,
      nextPlacement: PagePlacement,
      options: { readonly resetHistory?: boolean } = {}
    ) => {
      const token = handoffTokenRef.current + 1;
      handoffTokenRef.current = token;
      stagePendingHandoff({ token, pageId, placement: nextPlacement });
      enqueueCanvasCommit(pageId, nextPlacement, options, (outcome) => {
        if (outcome.status === "failed") {
          // The only true revert: the stage refused, so the optimistic
          // display canvas falls back to the authoritative (pre-edit) one.
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
        // drops the handoff once the authoritative canvas is equal, making
        // the pending → authoritative switch invisible.
        settledHandoffTokensRef.current = new Set([...settledHandoffTokensRef.current, token]);
      });
    },
    [enqueueCanvasCommit]
  );

  const commitDraggedCanvas = useCallback(
    (movedPlacement: PagePlacement, placementAtStart: PagePlacement) => {
      const current = workspaceRef.current;
      const pageId = pageIdRef.current;
      if (pageId === null) {
        return;
      }
      const page = findDesktopPage(current.snapshot, pageId);
      // The drag session already rejected stale canvases; this re-check pins
      // the commit to the exact workspace state the drag started from. It is
      // structural because a legacy page derives its placement per render.
      if (
        page === undefined ||
        !areCanvasLayoutsEqual(resolvePagePlacement(page), placementAtStart)
      ) {
        return;
      }
      if (areCanvasLayoutsEqual(movedPlacement, placementAtStart)) {
        return;
      }
      commitCanvasEdit(pageId, movedPlacement);
    },
    [commitCanvasEdit]
  );

  /**
   * Commits one finished resize gesture: exactly one workspace edit, one
   * stage and one sync attempt, no matter how many pointermoves preceded it
   * (the preview never stages anything).
   */
  const commitResizedGeometry = useCallback(
    (entityId: EntityId, geometry: ResizeCommitGeometry) => {
      const pageId = pageIdRef.current;
      if (pageId === null) {
        return;
      }
      const current = workspaceRef.current;
      const page = findDesktopPage(current.snapshot, pageId);
      if (page === undefined) {
        return;
      }
      const placement = resolvePagePlacement(page);
      if (placement.mode === "grid") {
        if (geometry.kind !== "grid") {
          return;
        }
        const item = placement.items.find((candidate) => candidate.id === entityId);
        if (
          item === undefined ||
          (item.column === geometry.geometry.column &&
            item.row === geometry.geometry.row &&
            item.columnSpan === geometry.geometry.columnSpan &&
            item.rowSpan === geometry.geometry.rowSpan)
        ) {
          return;
        }
        commitCanvasEdit(pageId, replaceGridItem(placement, { id: entityId, ...geometry.geometry }));
        return;
      }
      if (geometry.kind !== "freeform") {
        return;
      }
      const item = placement.items.find((candidate) => candidate.id === entityId);
      if (item === undefined || !("rect" in item) || areRectsEqual(item.rect, geometry.rect)) {
        return;
      }
      commitCanvasEdit(pageId, replaceCanvasItem(placement, { id: entityId, rect: geometry.rect }) as PagePlacement);
    },
    [commitCanvasEdit]
  );

  /**
   * A resize gesture started/ended — holds or releases the desktop lock.
   * Geometry commits flow through the same canvas handoff as drags.
   */
  const handleResizeSessionChange = useCallback((entityId: EntityId, active: boolean) => {
    setResizeSessionAppId(active ? entityId : null);
  }, []);

  /** Undo/Redo: the resulting canvas is a brand-new local edit. */
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
        const candidate =
          direction === "undo"
            ? undoPageCanvas(arrangeHistoriesRef.current, pageId)[pageId]
            : redoPageCanvas(arrangeHistoriesRef.current, pageId)[pageId];
        if (candidate === undefined || candidate === base) {
          return;
        }
        const current = workspaceRef.current;
        const page = findDesktopPage(current.snapshot, pageId);
        if (page === undefined || !areCanvasLayoutsEqual(resolvePagePlacement(page), base.present)) {
          // The canvas moved on since reconciliation — reset this page's
          // history instead of writing a stale snapshot.
          if (page !== undefined) {
            setArrangeHistories((current2) =>
              reconcilePageCanvasHistory(current2, pageId, resolvePagePlacement(page)),
            );
          }
          return;
        }
        const replaced = replacePageCanvas(current.snapshot, pageId, candidate.present);
        if (!replaced.ok) {
          return;
        }
        const staged = await stageWorkspaceAndTrySync(runtime, replaced.workspace);
        if (!staged.ok) {
          console.error(`VelaDesk: ${direction} was not staged (${staged.reason})`);
          return;
        }
        const nextMap: ArrangeCanvasHistories = {
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

  /**
   * Keyboard nudge: one rigid step for the whole selection. A grid section
   * steps by a whole cell; a freeform section by an eighth of one (about
   * 16 CSS px), so the keys stay useful in both models.
   */
  const nudgeSelection = useCallback(
    (columnStep: number, rowStep: number) => {
      const pageId = pageIdRef.current;
      if (
        pageId === null ||
        selectionRef.current.size === 0 ||
        // Nudges compute against the durable snapshot — wait out any handoff,
        // and never fight a live resize.
        pendingHandoffRef.current !== null ||
        resizeLockRef.current
      ) {
        return;
      }
      const current = workspaceRef.current;
      const page = findDesktopPage(current.snapshot, pageId);
      if (page === undefined) {
        return;
      }
      const placement = resolvePagePlacement(page);
      const ids = [...selectionRef.current];
      const moved =
        placement.mode === "grid"
          ? translateGridItems(placement, ids, columnStep, rowStep)
          : (() => {
              const cell = canvasCellSize(page.layout.grid);
              const step = {
                width: Math.max(1, Math.round(cell.width / 8)),
                height: Math.max(1, Math.round(cell.height / 8)),
              };
              return translateCanvasItems(
                placement,
                ids,
                columnStep * step.width,
                rowStep * step.height
              ) as PagePlacement;
            })();
      if (moved === placement) {
        // Failed nudge: no change, no history entry, no sync.
        return;
      }
      commitCanvasEdit(pageId, moved);
    },
    [commitCanvasEdit]
  );

  /**
   * Whether a Grid→Freeform switch would lose geometry (content beyond the
   * freeform viewport) — the switch is refused with a localized reason.
   */
  const freeformBlockedReason = useMemo(() => {
    if (activePage === undefined) {
      return null;
    }
    const placement = resolvePagePlacement(activePage);
    if (placement.mode !== "grid") {
      return null;
    }
    return canConvertGridToFreeform(placement.items, activePage.layout.grid)
      ? null
      : t("menu.placementFreeformBlocked");
  }, [activePage, t]);

  /**
   * Switches a section between Grid and Freeform placement (task 017).
   *
   * The mode is persisted per section. Switching TO Grid snaps every freeform
   * rect onto the page lattice in ONE atomic edit (columns from the page
   * grid); switching to Freeform converts each grid item back through the
   * same lattice — and is REFUSED when the conversion would be lossy
   * (content beyond the freeform viewport). Overlap stays legal; the switch
   * is structural and therefore not undoable: the page's history restarts
   * at the new placement.
   */
  const setPlacementMode = useCallback(
    (next: PagePlacementMode) => {
      const pageId = pageIdRef.current;
      if (pageId === null || pendingHandoffRef.current !== null || resizeLockRef.current) {
        return;
      }
      const current = workspaceRef.current;
      const page = findDesktopPage(current.snapshot, pageId);
      if (page === undefined) {
        return;
      }
      const placement = resolvePagePlacement(page);
      if (placement.mode === next) {
        return;
      }

      let nextPlacement: PagePlacement;
      if (next === "grid") {
        if (placement.mode !== "freeform") {
          return;
        }
        nextPlacement = {
          version: 2,
          mode: "grid",
          columns: page.layout.grid.columns,
          items: placement.items.map((item) => ({
            id: item.id,
            ...canvasRectToGridGeometry(item.rect, page.layout.grid),
          })),
        };
      } else {
        if (placement.mode !== "grid") {
          return;
        }
        const converted = gridLayoutToFreeform(placement, page.layout.grid);
        if (converted === null) {
          // Lossy conversion: never silently compress or drop geometry.
          return;
        }
        nextPlacement = converted;
      }
      commitCanvasEdit(pageId, nextPlacement, { resetHistory: true });
    },
    [commitCanvasEdit]
  );

  /**
   * The placement the ACTIVE section renders this frame: the pending handoff
   * while it targets the active page, otherwise the authoritative placement
   * (a stored one, or the v2 placement derived from v1/legacy geometry).
   * Only the active section consumes it — persistence still flows
   * exclusively through the domain/runtime path.
   */
  const displayPlacement =
    activePage !== undefined
      ? resolveDisplayPlacement(pendingCanvasHandoff, activePage.id, resolvePagePlacement(activePage))
      : null;

  // --- Metrics ---------------------------------------------------------------
  // Freeform measures the canvas box; Grid measures the stage width and
  // derives the square cells. Both hooks run unconditionally; their refs
  // only attach to whichever model the active section renders.
  const { canvasRef, metrics: freeformMetrics } = useCanvasMetrics();
  const activeColumns =
    displayPlacement !== null && displayPlacement.mode === "grid" ? displayPlacement.columns : 0;
  const { stageRef: gridStageRef, metrics: gridMetrics } = useSquareGridMetrics(
    activeColumns,
    displayGapPx,
  );

  const { dragging, handleDragStart, handleDragMove, handleDragEnd } = useCanvasDrag({
    placement: displayPlacement,
    metrics: freeformMetrics,
    pitchPx: gridMetrics?.pitchPx ?? null,
    onCommit: commitDraggedCanvas,
    getDragItemIds: useCallback(
      (sourceId: LayoutItemId) => resolveDragItemIds(sourceId, selectionRef.current),
      []
    ),
    resolveItemElement: useCallback((itemId: LayoutItemId) => {
      // The section viewport is a normal block; DOM queries work.
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
      // a second geometry session must not start on that base. A live icon
      // resize owns the pointer outright.
      if (pendingHandoffRef.current !== null || resizeLockRef.current) {
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
    applySelection(toggle ? toggleSelection(selectionRef.current, entityId) : new Set([entityId]));
  }, []);

  // --- Arrange marquee (rubber-band) selection, active section only ---------
  const handleViewportPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!arrange || draggingRef.current || resizeLockRef.current || event.button !== 0) {
        return;
      }
      // Only the empty canvas background starts a marquee — never an item.
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
        '[data-active-section="true"] .vela-grid-stage, [data-active-section="true"] .vela-canvas'
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

  // --- Context menu surface ----------------------------------------------------
  // While anything modal/drag-ish is up, the active section scroller must
  // not scroll (native CSS lock — no wheel parsing on the content path).
  const scrollLocked =
    dragging ||
    handoffLock ||
    resizeLock ||
    settingsOpen ||
    launcherOpen ||
    dialog !== null ||
    contextMenu !== null ||
    overlayFolderId !== null;

  /** Wheel navigation over the rail stands down while anything owns the desktop. */
  const railNavigationLocked = scrollLocked;

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
        isEmpty: pageItemIds(page).length === 0,
        callbacks: {
          onRename: () => openDialog({ kind: "rename-section", pageId }),
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

  async function handleDeleteSection(pageId: DesktopPageId) {
    // Decide the surviving neighbor BEFORE the deletion so the reveal can
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
    const pageId = effectiveActivePageId;
    if (pageId === null) {
      setDialogError(t("dialog.deleteFolder.error.noActivePage"));
      return;
    }
    const result = dissolveFolderToPage(snapshot, folderId, pageId);
    if (!result.ok) {
      setDialogError(
        result.reason === "folder-not-found"
          ? t("dialog.deleteFolder.error.folderGone")
          : t("dialog.deleteFolder.error.failed")
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

  // Keyboard: undo/redo, select all, launcher chord, Escape selection clear,
  // arrow nudge. Global section arrows are GONE — the rail owns section
  // keyboard navigation and the right side owns real vertical scrolling.
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
        // An in-flight icon resize consumes Escape itself (cancel, no write);
        // open surfaces consume it next; otherwise it clears the selection.
        if (resizeLockRef.current) {
          return;
        }
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
        !resizeLockRef.current &&
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
          applySelection(selectAllIds(new Set(pageItemIds(activePage))));
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
        !resizeLockRef.current &&
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
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [arrange, contextMenu, dialog, overlayFolderId, launcherOpen, settingsOpen, dragging, activePage, nudgeSelection, applyHistoryStep]);

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

  /**
   * The resizable items of the active section: exactly one selected app.
   *
   * A LIVE session must never remove the handles — they hold the pointer
   * capture, so unmounting them would drop the gesture mid-drag. Only a
   * pending geometry handoff suppresses them (and then the gesture is
   * already over), which also stops a second session from starting on a
   * rect the snapshot has not caught up with yet.
   */
  const resizableIds = useMemo<ReadonlySet<EntityId>>(() => {
    if (!arrange || activePage === undefined || handoffLock) {
      return EMPTY_ID_SET;
    }
    if (selectedItemIds.size !== 1) {
      return EMPTY_ID_SET;
    }
    const [id] = selectedItemIds;
    if (id === undefined) {
      return EMPTY_ID_SET;
    }
    const entity = snapshot.entities.find((candidate) => candidate.id === id);
    // Folders and widgets keep their default size: the product resizes app
    // tiles, and a group selection has no handles at all.
    return entity !== undefined && entity.kind === "app" ? new Set([id]) : EMPTY_ID_SET;
  }, [activePage, arrange, handoffLock, selectedItemIds, snapshot.entities]);

  if (activePage === undefined && pageIds.length === 0) {
    // Invariant violation (a workspace always has pages) — stay calm, stay
    // inspectable, never crash the tab.
    return (
      <main className="vela-screen">
        <div className="vela-screen__ambient" aria-hidden="true" />
        <section className="vela-screen__panel">
          <h1 className="vela-wordmark">VelaDesk</h1>
          <p className="vela-screen__lead">{t("recovery.noPages")}</p>
          <button type="button" className="vela-button" onClick={() => window.location.reload()}>
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

  // The exiting view renders read-only from the authoritative placement.
  const exitPage =
    sectionExit !== null ? findDesktopPage(snapshot, sectionExit.pageId) : undefined;

  // Arrange-toolbar availability (imperative history map, freshest value).
  const toolbarHistoryUsable =
    effectiveActivePageId !== null && !draggingRef.current && pendingHandoffRef.current === null;
  const toolbarCanUndo =
    toolbarHistoryUsable &&
    effectiveActivePageId !== null &&
    canUndo(arrangeHistoriesRef.current, effectiveActivePageId);
  const toolbarCanRedo =
    toolbarHistoryUsable &&
    effectiveActivePageId !== null &&
    canRedo(arrangeHistoriesRef.current, effectiveActivePageId);

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
        <div className="vela-workbench">
          <SectionRail
            pages={pages}
            activePageId={effectiveActivePageId}
            onSelectSection={(pageId) => switchSection(pageId)}
            onSectionContextMenu={(pageId, x, y) => openContextMenu({ kind: "section", pageId, x, y })}
            onOpenCommandMenu={(x, y) => openContextMenu({ kind: "desktop", x, y })}
            navigationLocked={railNavigationLocked}
          />

          <div className="vela-workspace">
            {arrange && activePage !== undefined ? (
              <ArrangeToolbar
                placementMode={displayPlacement?.mode ?? "grid"}
                freeformBlockedReason={freeformBlockedReason}
                onSetPlacementMode={setPlacementMode}
                gridGapPx={displayGapPx}
                onGridGapChange={handleGridGapChange}
                canUndo={toolbarCanUndo}
                canRedo={toolbarCanRedo}
                onUndo={() => {
                  if (pageIdRef.current !== null) {
                    applyHistoryStep(pageIdRef.current, "undo");
                  }
                }}
                onRedo={() => {
                  if (pageIdRef.current !== null) {
                    applyHistoryStep(pageIdRef.current, "redo");
                  }
                }}
              />
            ) : null}

            {/*
              The one section viewport: exactly the active section's content
              scroller (plus a brief exiting twin during transitions). While
              a modal or a drag is up, data-scroll-locked freezes scrolling
              without changing scrollTop.
            */}
            <div className="vela-section-viewport" ref={menuAreaRef} onContextMenu={handleAreaContextMenu}>
              {exitPage !== undefined && sectionExit !== null ? (
                <SectionView
                  key={`exit-${sectionExit.token}-${exitPage.id}`}
                  page={exitPage}
                  placement={resolvePagePlacement(exitPage)}
                  workspace={snapshot}
                  active={false}
                  phase={sectionExit.towards === "next" ? "exit-next" : "exit-prev"}
                  arrange={false}
                  dragEnabled={false}
                  scrollLocked
                  initialScrollTop={undefined}
                  metrics={null}
                  gridMetrics={null}
                  selectedIds={EMPTY_SELECTION}
                  resizableIds={EMPTY_ID_SET}
                  resizeActiveId={null}
                  onResizeCommit={commitResizedGeometry}
                  onResizeSessionChange={handleResizeSessionChange}
                  onItemSelect={handleItemSelect}
                  onEntityContextMenu={(entityId, x, y) =>
                    openContextMenu({ kind: "entity", entityId, source: "desktop", x, y })
                  }
                  onOpenFolder={(folderId) => openFolderOverlay(folderId)}
                />
              ) : null}

              {activePage !== undefined && displayPlacement !== null ? (
                <SectionView
                  key={activePage.id}
                  page={activePage}
                  placement={displayPlacement}
                  workspace={snapshot}
                  active
                  phase="active"
                  arrange={arrange}
                  dragEnabled={arrange && !handoffLock && !resizeLock}
                  scrollLocked={scrollLocked}
                  initialScrollTop={scrollMemoryRef.current.recall(activePage.id)}
                  onScrollerMount={(node) => {
                    activeScrollerRef.current = node;
                  }}
                  metrics={freeformMetrics}
                  gridMetrics={gridMetrics}
                  canvasRef={canvasRef}
                  gridStageRef={gridStageRef}
                  selectedIds={selectedItemIds}
                  resizableIds={resizableIds}
                  resizeActiveId={resizeActiveId}
                  onResizeCommit={commitResizedGeometry}
                  onResizeSessionChange={handleResizeSessionChange}
                  onItemSelect={handleItemSelect}
                  onEntityContextMenu={(entityId, x, y) =>
                    openContextMenu({ kind: "entity", entityId, source: "desktop", x, y })
                  }
                  onOpenFolder={(folderId) => openFolderOverlay(folderId)}
                  onCanvasPointerDown={handleViewportPointerDown}
                  onCanvasPointerMove={handleViewportPointerMove}
                  onCanvasPointerUp={handleViewportPointerUp}
                />
              ) : null}
            </div>

            {/*
              Sync state is a quiet GLOBAL status, not part of the section
              list: it renders only when there is something to say.
            */}
            <SectionSyncStatus workspace={workspace} lastRemoteResult={lastRemoteResult} />
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
        <EditAppDialog workspace={snapshot} appId={dialog.entityId} onClose={closeDialog} />
      ) : null}
      {dialog !== null && dialog.kind === "edit-visual" ? (
        <AppVisualEditor workspace={snapshot} appId={dialog.entityId} onClose={closeDialog} />
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
            dialog.kind === "rename-section" ? findDesktopPage(snapshot, dialog.pageId) : undefined
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
          pageId={effectiveActivePageId ?? pages[0]!.id}
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
 * so an arrange drop paints straight into its target geometry and stays
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

function findFolderEntity(workspace: WorkspaceSnapshot, folderId: EntityId): Folder | undefined {
  const entity = workspace.entities.find((candidate) => candidate.id === folderId);
  return entity !== undefined && entity.kind === "folder" ? entity : undefined;
}

/** The page whose canvas currently holds this entity, when any. */
function containerPageId(workspace: WorkspaceSnapshot, entityId: EntityId): DesktopPageId | null {
  const page = workspace.pages.find((candidate) => pageItemIds(candidate).includes(entityId));
  return page?.id ?? null;
}

function areRectsEqual(a: CanvasRect, b: CanvasRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
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
