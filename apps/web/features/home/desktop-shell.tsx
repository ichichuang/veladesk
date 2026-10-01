"use client";

import { DragDropProvider, useDragDropManager } from "@dnd-kit/react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import {
  VdHeroOverlayScope,
  VdPortalContainerProvider,
} from "@components/ui/overlay-scope";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import { useVdAmbientDrift } from "@components/vd/ambient-drift";
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
  DesktopPage,
  DesktopPageId,
  EntityId,
  Folder,
  WorkspaceAppearancePreferences,
  WorkspacePreferences,
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
import type { CanvasPixelMetrics } from "../canvas/canvas-metrics";
import type { SquareGridMetrics } from "../canvas/square-grid-metrics";
import type { GridItemGeometry, ResizeCommitGeometry } from "../canvas/canvas-resize";
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
import { AppAppearanceInspector } from "./app-appearance-inspector";
import {
  appearanceHandoffSettled,
  openAppearanceSession,
  projectRenderedWorkspace,
  type AppAppearanceSession,
} from "./app-appearance-session";
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
import {
  WorkspaceWallpaperLayers,
  useWallpaperAssetUrl,
  type BackgroundPreview,
} from "./desktop-wallpaper";
import { getBrowserAssetRuntime } from "../assets/browser-assets";
import type { PreparedWallpaperImage } from "./wallpaper-prep";
import {
  resolveEffectiveWallpaper,
  replacePageWallpaper,
} from "@veladesk/domain";
import type { WallpaperConfig } from "@veladesk/domain";
import { SectionSyncStatus } from "./section-sync-status";
import { SectionLayer, SectionView } from "./section-view";
import { createSectionPairCoordinator } from "./section-pair-animator";
import type { SectionPairCoordinator, SectionPairSettledListener } from "./section-pair-animator";
import {
  IDLE_SECTION_NAV,
  deriveLayerPhase,
  interactiveActiveIdOf,
  pruneMissingSections,
  reportLayerSettled,
  requestSection,
  startPreparedTransition,
  visibleActiveIdOf,
} from "./section-transition-machine";
import type { SectionNavMachine } from "./section-transition-machine";
import { scopedToLayer } from "./section-layer-query";
import { resolveWarmSectionIds } from "./section-warm-cache";
import { SectionScrollMemory } from "./section-scroll-memory";
import { loadWorkspaceViewState, type WorkspaceViewStateV1 } from "./workspace-view-state";
import {
  useWorkspaceActiveSection,
  type WorkspaceActiveSection,
} from "./workspace-active-section";
import { useSystemPrefersLight } from "./use-system-prefers-light";
import { normalizeSelection, selectAllIds, toggleSelection } from "./selection-state";
import { normalizeSelectionRect, selectIntersectingItemIds } from "./selection-geometry";
import {
  resolveSectionAfterDelete,
  sectionTransitionDirection,
} from "./section-navigation-model";
import { stageWorkspaceAndTrySync } from "./workspace-commit";
import { launchApp } from "./launch-app";
import { buildAppearanceTheme, resolveEffectiveColorMode } from "./appearance-theme";
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

const EMPTY_SELECTION: ReadonlySet<LayoutItemId> = new Set();
const EMPTY_ID_SET: ReadonlySet<EntityId> = new Set();

interface DesktopShellProps {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
  /**
   * The externally-owned shared active section (task 026 §17): supplied by
   * ResponsiveWorkspaceShell so desktop and mobile point at ONE active
   * section across shell switches. Absent (standalone/test renders) the
   * shell owns the section itself through the same shared hook — the
   * pre-026 behavior, unchanged.
   */
  readonly activeSection?: WorkspaceActiveSection | undefined;
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
export function DesktopShell({ workspace, lastRemoteResult, activeSection: externalActiveSection }: DesktopShellProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const { locale, t } = useI18n();
  const snapshot = workspace.snapshot;
  const reducedMotion = useVdReducedMotion();

  // Ambient wallpaper drift (022): one GSAP-owned yoyo on a real node
  // (the CSS ::before keyframes are gone). Pure decoration behind
  // everything; reduced motion renders a static backdrop.
  const desktopAmbientRef = useRef<HTMLDivElement | null>(null);
  useVdAmbientDrift(desktopAmbientRef, { durationSeconds: 30 });

  const [mode, setMode] = useState<DesktopMode>(() =>
    snapshot.preferences.layoutLocked ? "view" : "arrange"
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<HomeDialog | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [overlayFolderId, setOverlayFolderId] = useState<EntityId | null>(null);
  /**
   * The last OPENED folder entity (022): during the overlay's exit the id
   * is already null, so this mirror keeps the fading surface rendering
   * real content. Set together with the id (one batched open commit);
   * cleared only when the surface is fully closed.
   */
  const [lastOverlayFolder, setLastOverlayFolder] = useState<Folder | null>(null);

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
   * Live background draft preview (023-C): ONE scope-keyed layer fed by the
   * Settings background editor — the workspace layer or the ACTIVE
   * section's layer, exactly what the resolver substitutes. Cleared on
   * Cancel/close and after a successful Save (the snapshot then carries
   * the same config, so there is no flash-back).
   */
  const [backgroundPreview, setBackgroundPreview] = useState<BackgroundPreview | null>(null);
  /** The section whose context menu opened Settings (its scope preselected). */
  const [settingsBackgroundSection, setSettingsBackgroundSection] = useState<DesktopPageId | null>(null);
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
   * The per-mount persisted view state (task 023-A): read ONCE per mounted
   * shell, hydration-safe like every other boot read, and used ONLY to
   * seed the session scroll memory — the ACTIVE SECTION itself is owned by
   * the shared hook below (026 §17).
   */
  const bootPersistedRef = useRef<{ readonly persisted: WorkspaceViewStateV1 | null } | null>(null);
  const bootPersisted = useCallback(() => {
    bootPersistedRef.current ??= {
      persisted: loadWorkspaceViewState(window.localStorage, workspace.id),
    };
    return bootPersistedRef.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately mount-scoped: reads the shell's FIRST workspace record exactly once
  }, []);

  const pageIds = useMemo(() => snapshot.pages.map((page) => page.id), [snapshot.pages]);

  /**
   * The ACTIVE section owner (026 §17): the shared minimal controller,
   * either the externally-owned instance from ResponsiveWorkspaceShell or
   * — for standalone renders — an internally-owned one with exactly the
   * pre-026 boot/persistence semantics. The effective fallback (default
   * section, then first) lives in the hook, derived so structural changes
   * reconcile within one render.
   */
  const activeSection = useWorkspaceActiveSection({
    external: externalActiveSection,
    workspaceId: workspace.id,
    pageIds,
    defaultSectionId: snapshot.preferences.defaultPageId,
    captureActiveScroll,
  });
  const effectiveActivePageId = activeSection.effectiveActivePageId;
  /**
   * The MOUNTED sections (task 020-A2): the warm set around the active
   * section — previous, active, next — kept mounted, hidden and
   * layout-ready so a switch never builds the destination tree inside the
   * commit that starts the visible transition. Rotated ONLY when the
   * navigation machine settles (never during a visible transition).
   */
  const [mountedSectionIds, setMountedSectionIds] = useState<readonly DesktopPageId[]>(() =>
    resolveWarmSectionIds({
      pageOrder: snapshot.pages.map((page) => page.id),
      activePageId: activeSection.activePageId,
    })
  );
  /**
   * The section-navigation machine (020-A2 §15): idle / preparing-target /
   * transitioning, separating mounted content from the visible transition.
   * Pure model in section-transition-machine.ts; the shell applies its
   * lifecycle flips and renders one stable layer per mounted section.
   */
  const [sectionNavMachine, setSectionNavMachine] = useState<SectionNavMachine>(
    IDLE_SECTION_NAV
  );
  /**
   * The shared overlay portal root element (themed sibling of the desktop
   * root — see the render). State so newly mounted dialogs re-render with
   * the container available.
   */
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);
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

  const activePage =
    effectiveActivePageId !== null
      ? findDesktopPage(snapshot, effectiveActivePageId)
      : undefined;

  // --- Appearance editing session (task 019-C) ----------------------------
  // While the inspector is open, the desktop renders the persisted snapshot
  // + this draft through ONE canonical projection (app-appearance-session)
  // — the real placed app is the live preview, never a simulated tile.
  // Cancel drops the session immediately. After a successful Save the
  // panel closes but the session may outlive it as an INERT override:
  // once the authoritative snapshot structurally carries the projected
  // app, projecting changes nothing (rendered === persisted), so there is
  // no bounce and nothing to reconcile — the derivation below simply
  // stops using it. A stale inert session costs nothing and is replaced
  // by the next editing session.
  const [appearanceSession, setAppearanceSession] = useState<AppAppearanceSession | null>(null);
  const inspectorOpen = dialog !== null && dialog.kind === "edit-visual";
  const effectiveAppearanceSession = useMemo(() => {
    if (appearanceSession === null) {
      return null;
    }
    if (!inspectorOpen && appearanceHandoffSettled(snapshot, appearanceSession)) {
      return null; // Inert: the persisted app IS the projection.
    }
    return appearanceSession;
  }, [appearanceSession, inspectorOpen, snapshot]);
  const renderedSnapshot = useMemo(
    () => projectRenderedWorkspace(snapshot, effectiveAppearanceSession),
    [snapshot, effectiveAppearanceSession]
  );
  /** The app the inspector edits — drives the quiet desktop affordance. */
  const appearanceEditingId = inspectorOpen ? (appearanceSession?.appId ?? null) : null;

  /**
   * The rendered theme: the Settings preview while open, otherwise the
   * persisted appearance (legacy snapshots resolve to the Task013
   * defaults). This is the ONLY theme source — no component reads
   * appearance individually, everything inherits the CSS variables.
   */
  const resolvedAppearance = appearancePreview ?? resolveWorkspaceAppearance(snapshot.preferences);
  const theme = useMemo(() => buildAppearanceTheme(resolvedAppearance), [resolvedAppearance]);
  /**
   * The EFFECTIVE color mode (021-R1): "system" resolves against the OS
   * preference (live, via matchMedia) before it reaches the DOM or any
   * library theme attribute. Both themed roots — the desktop and the shared
   * overlay portal root — always carry the same effective value, so every
   * portaled overlay subtree inherits exactly one palette. A live OS theme
   * switch re-renders the shell through the matchMedia listener below.
   */
  const systemPrefersLight = useSystemPrefersLight();
  const effectiveColorMode = useMemo(
    () => resolveEffectiveColorMode(theme.colorMode, systemPrefersLight),
    [theme.colorMode, systemPrefersLight],
  );

  /**
   * The effective wallpaper of the VISIBLE section (023-C.4): resolved
   * through the ONE canonical resolver with the Settings draft layers
   * substituted per scope (a workspace draft never masks a saved section
   * override). Bound to the machine-visible destination — never an early
   * requested id that has not become a visible page.
   */
  const visibleSectionId = visibleActiveIdOf(sectionNavMachine, effectiveActivePageId);
  const effectiveWallpaper = useMemo(() => {
    const page =
      visibleSectionId === null
        ? undefined
        : renderedSnapshot.pages.find((candidate) => candidate.id === visibleSectionId);
    const pageDraftActive =
      backgroundPreview !== null &&
      backgroundPreview.scope === visibleSectionId &&
      !backgroundPreview.explicitlyInherits;
    return resolveEffectiveWallpaper({
      page,
      pageWallpaperDraft: pageDraftActive ? backgroundPreview.config : undefined,
      pageWallpaperExplicitlyInherits:
        backgroundPreview !== null &&
        backgroundPreview.scope === visibleSectionId &&
        backgroundPreview.explicitlyInherits,
      workspaceWallpaper: resolvedAppearance.wallpaper,
      workspaceDraft:
        backgroundPreview !== null && backgroundPreview.scope === "workspace"
          ? { config: backgroundPreview.config }
          : undefined,
      legacyWorkspacePreset: resolvedAppearance.wallpaperPreset,
    });
  }, [renderedSnapshot.pages, visibleSectionId, backgroundPreview, resolvedAppearance]);

  /** Resolves asset-backed wallpapers through the existing asset runtime. */
  const loadWallpaperAsset = useCallback(async (assetId: string) => {
    try {
      const runtime = await getBrowserAssetRuntime();
      const result = await runtime.loadAsset(assetId);
      if (result.ok && "blob" in result && result.blob instanceof Blob) {
        return { ok: true, url: URL.createObjectURL(result.blob) };
      }
      return { ok: false, url: null };
    } catch {
      return { ok: false, url: null };
    }
  }, []);
  const wallpaperAssetId =
    effectiveWallpaper.config.kind === "asset" ? effectiveWallpaper.config.assetId : null;
  const resolvedWallpaperUrl = useWallpaperAssetUrl(wallpaperAssetId, loadWallpaperAsset);
  // A pending (not-yet-staged) image previews through its own object URL.
  const wallpaperAssetUrl =
    backgroundPreview?.pendingAssetId !== undefined &&
    backgroundPreview.pendingAssetId === wallpaperAssetId &&
    backgroundPreview.previewUrl !== undefined
      ? backgroundPreview.previewUrl
      : resolvedWallpaperUrl;

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

  // The launcher renders app icons through the SHARED renderer, so it needs
  // the live entities — same lifecycle as the entries above.
  const launcherAppsById = useMemo(() => {
    const apps = new Map<EntityId, AppShortcut>();
    for (const entity of snapshot.entities) {
      if (entity.kind === "app") {
        apps.set(entity.id, entity);
      }
    }
    return apps;
  }, [snapshot.entities]);

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
  /**
   * Per-section scroll memory. Session-shaped as since task 017, but now
   * SEEDED at boot from the persisted workspace view state (023-A): the
   * remembered sections restore through the EXISTING SectionView
   * mount-restore mechanics — no second scroll system, no animated
   * scrolling, and no scroll-event persistence (entries are captured on
   * logical boundaries only).
   */
  const scrollMemoryRef = useRef<SectionScrollMemory | null>(null);
  const sectionScrollMemory = useCallback((): SectionScrollMemory => {
    if (scrollMemoryRef.current === null) {
      const memory = new SectionScrollMemory();
      const persisted = bootPersisted().persisted;
      if (persisted !== null) {
        for (const [sectionId, scrollTop] of Object.entries(
          persisted.scrollTopBySectionId,
        )) {
          memory.save(sectionId, scrollTop);
        }
      }
      scrollMemoryRef.current = memory;
    }
    return scrollMemoryRef.current;
  }, [bootPersisted]);
  /**
   * Imperative mirrors of the navigation machine and the mounted warm set:
   * event handlers and animation completion callbacks must always read the
   * freshest state without re-binding (same pattern as the history map).
   */
  const navMachineRef = useRef<SectionNavMachine>(IDLE_SECTION_NAV);
  const mountedIdsRef = useRef<readonly DesktopPageId[]>(mountedSectionIds);
  /**
   * Navigation request identity (021-R1): every accepted request (and every
   * instant/reduced-motion swap) mints the next generation. Animation
   * completions carry a generation; a completion from a superseded request
   * can never settle, rotate or cancel the newer one.
   */
  const navGenerationRef = useRef(0);
  /**
   * A layer REST is pending an idle commit (022-R2). Resting a layer means
   * normalizing it to the hidden-cache origin (y 0, opacity 1) — legal only
   * once the commit that retires the machine has ALSO flipped the exited
   * page's phase to warm-hidden. Every path that idles the machine from a
   * context whose commit has not landed yet (GSAP completion callbacks,
   * passive effects) sets this flag instead of writing styles; the
   * pair-command layout effect below performs the rest pre-paint in the
   * very commit that hides the exited page, so no painted frame can show
   * the just-exited page back at the viewport origin.
   */
  const restLayersOnIdleRef = useRef(false);
  /**
   * The GSAP page-pair coordinator (task 022): ONE timeline owns the
   * visible page pair for each category transition. Created lazily (this
   * component only renders client-side); disposed on unmount. The shell
   * feeds it machine commands from a layout effect and receives exactly
   * one generation-guarded settle per transition.
   */
  const pairCoordinatorRef = useRef<SectionPairCoordinator | null>(null);
  function pairCoordinator(): SectionPairCoordinator {
    pairCoordinatorRef.current ??= createSectionPairCoordinator();
    return pairCoordinatorRef.current;
  }
  /** Stable registration identity for the layers' ref callbacks. */
  const registerSectionLayer = useCallback(
    (pageId: DesktopPageId, node: HTMLElement | null) => {
      pairCoordinator().registerLayer(pageId, node);
    },
    [],
  );
  /**
   * The scheduled arm frame for a prepared cold target (021-R1): the mount
   * commit must get one LAYOUT pass — with its ResizeObserver notifications
   * and adaptive-content settle — before the visible transition starts.
   * Discrete-event commits flush their effects before the browser paints,
   * so arming synchronously in the lifecycle effect could reveal the target
   * inside the very commit that mounted it — the reported stall-then-jump.
   * A single animation frame guarantees exactly that settle pass (rAF
   * callbacks run before their frame paints; whether the hidden mount frame
   * itself reaches the screen depends on when the lifecycle effect ran
   * relative to that frame's rAF phase — the paint is not the contract, the
   * layout pass is). Cancelled on supersede and unmount.
   */
  const armFrameRef = useRef<number | null>(null);
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

  /** Applies the machine state, mirror ref included. */
  const applySectionNav = useCallback((machine: SectionNavMachine) => {
    navMachineRef.current = machine;
    setSectionNavMachine(machine);
  }, []);

  /** Applies the mounted warm set, mirror ref included. */
  const applyMountedSections = useCallback((mountedIds: readonly DesktopPageId[]) => {
    mountedIdsRef.current = mountedIds;
    setMountedSectionIds(mountedIds);
  }, []);

  /**
   * Warm-set rotation (020-A2 §13): recompute the ±1 window around the
   * settled active section. Runs ONLY when the machine reaches idle — the
   * new neighbor mounts hidden and the far section unmounts after the
   * visible navigation has settled, never inside it (§14).
   */
  const rotateWarmSet = useCallback(
    (activeId: DesktopPageId | null) => {
      const pageOrder = workspaceRef.current.snapshot.pages.map((page) => page.id);
      applyMountedSections(resolveWarmSectionIds({ pageOrder, activePageId: activeId }));
    },
    [applyMountedSections]
  );

  /**
   * Latest-value mirror so the pair-settle callback never closes over a
   * stale switchSection identity (assigned in an effect below — switchSection
   * is declared later in this body; a settle can never fire before effects run).
   */
  const switchSectionRef = useRef<(pageId: DesktopPageId) => void>(() => {});

  /**
   * The page pair settled (task 022): the coordinator reports ONE
   * generation-guarded completion per transition. The shell evaluates it
   * against the CURRENT machine (a stale generation or an unknown layer is
   * a no-op there), idles the machine, rotates the warm set, and starts a
   * parked third-target request immediately — no added settle delay.
   *
   * 022-R2: the completion fires inside the GSAP tick, BEFORE React commits
   * the machine→idle update — the exited page's DOM still carries its
   * visible `exit` phase here. The layers are therefore NOT rested
   * synchronously (that wrote the just-exited page back to the viewport
   * origin for the frames between this tick and the commit — the reported
   * "arrives, briefly returns, flashes again" rollback); the rest is
   * deferred to the idle commit's layout effect, which runs pre-paint with
   * the exited page already warm-hidden.
   */
  const handlePairSettled = useCallback<SectionPairSettledListener>(
    (pageId) => {
      const machine = navMachineRef.current;
      // A parked third destination is read BEFORE the settle report: the
      // report itself retires the transition state that carries it.
      const pendingId = machine.kind === "transition" ? machine.pendingId : null;
      // The report is evaluated against the CURRENT machine: a superseded
      // generation or an unknown layer is a no-op there.
      const next = reportLayerSettled(
        machine,
        pageId,
        machine.kind === "idle" ? navGenerationRef.current : machine.generation,
      );      if (next === machine) {
        return;
      }
      applySectionNav(next);
      if (next.kind === "idle") {
        // Final poses → rest — deferred to the idle commit (see the ref
        // above); the destination layer stays the same mounted node at
        // y=0/opacity 1 through this boundary. The transitioning attribute
        // drops with that commit and the glass blur policy restores.
        restLayersOnIdleRef.current = true;        rotateWarmSet(pageIdRef.current);
        if (pendingId !== null && pendingId !== pageIdRef.current) {
          // Bounded latest-target continuation: the newest third
          // destination starts right now, from the settled boundary.          switchSectionRef.current(pendingId);
        }
      }
    },
    [applySectionNav, rotateWarmSet],
  );

  useEffect(() => {
    switchSectionRef.current = switchSection;
  });

  /**
   * Arms a prepared cold target after its hidden mount has had its
   * preparation LAYOUT pass (§16, re-grounded 021-R1): the lifecycle effect
   * schedules a single animation frame — the hidden destination's observers
   * and adaptive layout settle in that pass (see {@link armFrameRef} for
   * the exact paint-vs-layout semantics), and only then does the visible
   * transition start. Synchronous arming could run inside the discrete
   * event's commit, revealing the target before any preparation pass
   * existed (the reported stall-then-jump on cold switches). The frame is
   * cancelled on supersede and unmount; a callback whose machine moved on
   * (newer generation, no longer prepared) is discarded.
   */
  function armPreparedSection() {
    const machine = navMachineRef.current;
    if (machine.kind !== "prepared") {
      return;
    }
    if (armFrameRef.current !== null) {
      return;
    }
    armFrameRef.current = requestAnimationFrame(() => {
      armFrameRef.current = null;
      const current = navMachineRef.current;
      if (current.kind !== "prepared") {
        return; // superseded while the preparation frame elapsed
      }
      applySectionNav(startPreparedTransition(current));
    });
  }

  /**
   * Structural reconciliation: vanished pages can never report a settle,
   * so they are pruned from the machine instead of stalling it. Same
   * plain-helper shape as armPreparedSection.
   */
  function pruneNavMachine() {
    const next = pruneMissingSections(
      navMachineRef.current,
      workspaceRef.current.snapshot.pages.map((page) => page.id)
    );
    if (next === navMachineRef.current) {
      return;
    }
    applySectionNav(next);
    if (next.kind === "idle") {
      pairCoordinator().halt();
      restLayersOnIdleRef.current = true;      rotateWarmSet(pageIdRef.current);
    }
  }

  /**
   * Section switching with the whole-page vertical transition (018,
   * re-architected 020-A2).
   *
   * The destination is normally ALREADY MOUNTED (the warm ±1 set), so the
   * machine starts the visible transition without creating a single new
   * component (§29 — mounted set unchanged on a warm request). A cold
   * destination mounts hidden first and is revealed one render lifecycle
   * later (§16). New intent during an in-flight transition retargets every
   * layer from its current visual position — the latest target always
   * wins, there is no queue. Instant reveals (structural changes) are a
   * machine-level no-transition switch: no presence subtree is ever
   * remounted (§21). The outgoing section's scrollTop is remembered; a
   * still-mounted warm page keeps its live scroll untouched, and only an
   * evicted page re-runs the mount-time restore (§30).
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
      const pageOrder = pages.map((page) => page.id);
      // 021-R3: input-handler entry. This is when the handler ran, NOT the
      // hardware input time.      // One pure direction source for every path (019-E §23), computed
      // from the VISIBLE section so an interruption animates the way the
      // user currently sees.
      const visibleId = visibleActiveIdOf(navMachineRef.current, currentId);
      const direction = sectionTransitionDirection(
        visibleId === null ? -1 : pageOrder.indexOf(visibleId),
        pageOrder.indexOf(pageId)
      );
      if (direction === null) {
        return;
      }

      // Remember the OUTGOING (visible) section's scroll position (session
      // only). Scoped to the VISIBLE page's own layer (021-R1): during an
      // interrupted transition more than one layer can carry
      // data-active-section, so the old attribute lookup could save the
      // wrong page's scrollTop under this page's id.
      if (visibleId !== null) {
        const visibleLayer = menuAreaRef.current?.querySelector(
          scopedToLayer(visibleId, ".vela-section-scroller") ?? ""
        );
        if (visibleLayer instanceof HTMLDivElement) {
          sectionScrollMemory().save(visibleId, visibleLayer.scrollTop);
          // 023-A: the outgoing section's scrollTop rides the same logical
          // leave-section boundary into the persisted view state — never a
          // per-scroll-event write.
          activeSection.recordScrollTop(visibleId, visibleLayer.scrollTop);
        }
      }

    if (options.animate === false || reducedMotion) {
      // Instant swap: no transition state at all, warm set rotates now.
      // The generation bump retires any in-flight animation completion —
      // reduced motion keeps the same visibility invariants (exactly one
      // painted section at rest) without the animated path.
      const wasIdle = navMachineRef.current.kind === "idle";
      navGenerationRef.current += 1;
      applySectionNav(IDLE_SECTION_NAV);
      applyMountedSections(resolveWarmSectionIds({ pageOrder, activePageId: pageId }));
      // Any mid-flight pair pose is retired with the machine (022). Only
      // the timeline dies here — the layer REST waits for the idle commit
      // (022-R2): this handler can run in a passive effect (the structural
      // reveal path), where the DOM still shows the exited page's visible
      // phase and a synchronous rest would paint it at the origin.
      pairCoordinator().halt();
      restLayersOnIdleRef.current = true;
      if (!wasIdle) {
        // The transitioning attribute drops: the glass blur policy restores.
      }
      // 023-A: continuity records the LOGICAL destination at request time —
      // a refresh mid-slide reopens on the section the user asked for, and
      // navigation never waits for the 0.5s pair to finish.
      activeSection.requestActiveSection(pageId);
      return;
    }

    // Direction only: the pair coordinator measures the live viewport
    // height at command time (task 022 full-height slide).
    const intent = { direction };
    const generation = navGenerationRef.current + 1;
    const outcome = requestSection({
      machine: navMachineRef.current,
      mountedIds: mountedIdsRef.current,
      pageOrder,
      currentActiveId: currentId,
      targetId: pageId,
      intent,
      generation,
    });
    if (outcome === null) {
      return;
    }
    const wasIdle = navMachineRef.current.kind === "idle";
    // The machine may keep the RUNNING generation (a parked third target
    // only updates pendingId) — the ref follows the machine, never the
    // request counter.
    const outcomeGeneration =
      outcome.machine.kind === "prepared" || outcome.machine.kind === "transition"
        ? outcome.machine.generation
        : generation;
    navGenerationRef.current = outcomeGeneration;
    applySectionNav(outcome.machine);
    if (wasIdle) {
      // The transitioning attribute rises: the glass blur policy suspends.
    }
    applyMountedSections(outcome.mountedIds);
    // 023-A: accepted navigation — the destination is the user's latest
    // intent, persisted immediately in memory (disk follows coalesced).
    activeSection.requestActiveSection(pageId);
  },
    [activeSection, applyMountedSections, applySectionNav, reducedMotion, sectionScrollMemory]
  );

  /**
   * Machine lifecycle, flip 1 of 1 (020-A2 §16, reveal after the
   * preparation pass, 021-R1): a prepared cold target arms once its hidden
   * mount has settled — see {@link armPreparedSection}. StrictMode's
   * setup-cleanup-setup reschedules idempotently; superseded generations
   * discard their callback.
   */
  useEffect(() => {
    armPreparedSection();
    return () => {
      if (armFrameRef.current !== null) {
        cancelAnimationFrame(armFrameRef.current);
        armFrameRef.current = null;
      }
    };
  });

  /** Structural reconciliation: prune vanished pages out of the machine. */
  useEffect(() => {
    pruneNavMachine();
  });

  /**
   * The pair-command effect (task 022): while the machine is in a visible
   * transition, feed the coordinator ONE command per generation. Everything
   * else — prepared (a cold target measuring hidden, any superseded exit
   * still animating), idle — intentionally leaves the coordinator alone:
   * an in-flight pair keeps running to its boundary, and explicit idle
   * paths (settle, instant swap, prune) schedule their own rest.
   * Identical re-applies are skipped inside the coordinator.
   *
   * 022-R2: this layout effect is also the REST boundary for the idle
   * paths. It runs pre-paint in the very commit that flips the exited page
   * to warm-hidden, so resting there can never paint the exited page back
   * at the viewport origin; a superseding request in the same window
   * consumes the flag here too — its command application rests every
   * non-participant (the previous exit included, hidden by that commit).
   */
  useLayoutEffect(() => {
    const machine = navMachineRef.current;
    if (machine.kind === "transition" && !reducedMotion) {
      restLayersOnIdleRef.current = false;
      const outgoingId = machine.exitingIds[machine.exitingIds.length - 1];
      if (outgoingId === undefined) {
        return;
      }
      const coordinator = pairCoordinator();
      const incoming = coordinator.layerElement(machine.toId);
      const outgoing = coordinator.layerElement(outgoingId);
      if (incoming === null || outgoing === null) {
        return; // the pair commits with the next render's layers
      }
      coordinator.apply(
        {
          generation: machine.generation,
          incomingId: machine.toId,
          outgoingId,
          direction: machine.intent.direction,
          enterFromOffset: machine.enterFromOffset,
          viewportHeight: menuAreaRef.current?.clientHeight ?? 480,
        },
        handlePairSettled,
      );
      return;
    }
    if (restLayersOnIdleRef.current) {
      restLayersOnIdleRef.current = false;
      pairCoordinator().settleAll();
    }
  });

  /**
   * A reduced-motion preference flipping ON mid-transition settles the
   * machine immediately: valid product state without waiting out the
   * interpolation, and the stale completion can never fire afterwards.
   */
  useEffect(() => {
    if (!reducedMotion || navMachineRef.current.kind === "idle") {
      return;
    }
    navGenerationRef.current += 1;    applySectionNav(IDLE_SECTION_NAV);
    pairCoordinator().halt();
    restLayersOnIdleRef.current = true;
    rotateWarmSet(pageIdRef.current);
  }, [reducedMotion, applySectionNav, rotateWarmSet]);

  // Unmount: the coordinator's GSAP objects die with the shell.
  useEffect(() => {
    return () => {
      pairCoordinatorRef.current?.dispose();
      pairCoordinatorRef.current = null;
    };
  }, []);

  /**
   * DOM scroll capture for the shared view-state flush boundaries (023-A,
   * lifted 026 §17): the shared active-section hook owns the controller,
   * its pagehide/unmount flushes and the disk writes; the DESKTOP-SPECIFIC
   * half — reading the active scroller's live scrollTop into the session
   * memory and the persisted view state — happens here, invoked by the
   * hook right before every synchronous flush.
   */
  function captureActiveScroll() {
    const activeId = pageIdRef.current;
    if (activeId === null) {
      return;
    }
    const scroller = menuAreaRef.current?.querySelector(
      scopedToLayer(activeId, ".vela-section-scroller") ?? ""
    );
    if (scroller instanceof HTMLDivElement) {
      sectionScrollMemory().save(activeId, scroller.scrollTop);
      activeSection.recordScrollTop(activeId, scroller.scrollTop);
    }
  }
  // Keep the hook's latest-value mirror current across renders.

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

  /**
   * Opens a folder overlay. Stable identity: warm section layers receive
   * it as a prop and must not re-render when the shell does (020-A2 §18).
   */
  const openFolderOverlay = useCallback((folderId: EntityId) => {
    setFolderActionError(null);
    setOverlayFolderId(folderId);
    // 022: remember the opened entity so the exit animation keeps real
    // content after the close intent clears the id (batched: one commit).
    const folder = workspaceRef.current.snapshot.entities.find(
      (entity): entity is Folder => entity.kind === "folder" && entity.id === folderId
    );
    setLastOverlayFolder(folder ?? null);
  }, []);

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
    setSettingsBackgroundSection(null);
    setSettingsOpen(true);
  }

  /**
   * Enters Settings through a section's context menu (023-C.2): the SAME
   * window and shared background editor open with that exact section's
   * scope preselected — no duplicate editor.
   */
  function openSectionBackgroundSettings(pageId: DesktopPageId) {
    setContextMenu(null);
    setAppearancePreview(null);
    setSettingsBackgroundSection(pageId);
    setSettingsOpen(true);
  }

  /** Cancel/close: the preview dies with the surface, nothing was staged. */
  function closeSettings() {
    setAppearancePreview(null);
    setBackgroundPreview(null);
    setSettingsBackgroundSection(null);
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
  async function handleSettingsSave(
    draft: WorkspaceSettingsDraft,
    images: readonly PreparedWallpaperImage[] = [],
  ): Promise<SettingsSaveResult> {
    // 023-C.3 transaction: stage the required image ASSETS first (the
    // asset-before-workspace ordering), then apply ONE workspace edit that
    // carries the ordinary Settings changes AND every scoped background
    // patch — the normal result is ONE workspace revision, not one per
    // field or page. All patches apply to the CURRENT validated snapshot
    // (never the copy captured when Settings opened).
    if (images.length > 0) {
      try {
        const assetRuntime = await getBrowserAssetRuntime();
        for (const image of images) {
          const stagedAsset = await assetRuntime.stageAsset(image.asset.blob);
          if (!stagedAsset.ok) {
            return { ok: false, message: t("settings.error.wallpaperStageFailed") };
          }
        }
      } catch (error) {
        console.error("VelaDesk: wallpaper asset staging failed", error);
        return { ok: false, message: t("settings.error.wallpaperStageFailed") };
      }
    }

    // The workspace wallpaper patch rides the preferences edit; null means
    // removal (the field is omitted so the legacy preset resolves again).
    const draftPreferences = preferencesFromSettingsDraft(draft);
    const baseAppearance: WorkspaceAppearancePreferences =
      draftPreferences.appearance ?? resolveWorkspaceAppearance(draftPreferences);
    const appearance: WorkspaceAppearancePreferences =
      draft.background.workspace === undefined
        ? baseAppearance
        : draft.background.workspace === null
          ? (() => {
              const { wallpaper: removed, ...rest } = baseAppearance;
              void removed;
              return rest;
            })()
          : { ...baseAppearance, wallpaper: draft.background.workspace };
    const preferences: WorkspacePreferences = { ...draftPreferences, appearance };

    let result = replaceWorkspacePreferences(workspaceRef.current.snapshot, preferences);
    if (result.ok) {
      for (const [pageId, patch] of Object.entries(draft.background.pages)) {
        if (patch === undefined) {
          continue;
        }
        const next = replacePageWallpaper(
          result.workspace,
          pageId,
          patch as WallpaperConfig | null,
        );
        if (!next.ok) {
          // A deleted target page: keep the draft and explain — never
          // recreate a page or reference missing bytes.
          result = { ok: false, reason: "page-not-found" };
          break;
        }
        result = next;
      }
    }
    if (!result.ok) {
      return {
        ok: false,
        message:
          result.reason === "page-not-found"
            ? t("settings.error.backgroundTargetGone")
            : result.reason === "default-page-not-found"
              ? t("settings.error.defaultPageGone")
              : result.reason === "invalid-grid-gap"
                ? t("settings.error.invalidGridGap")
                : result.reason === "invalid-wallpaper"
                  ? t("settings.error.invalidAppearance")
                  : t("settings.error.invalidAppearance"),
      };
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      console.error(`VelaDesk: settings were not staged (${staged.reason})`);
      return { ok: false, message: t("settings.error.saveFailed") };
    }
    // Success: both previews clear; the snapshot now carries the same
    // configs the preview showed, so nothing flashes back. The pending
    // preview URL stays valid for the rendered draft until React drops it
    // (the persisted asset resolves to the same content id).
    setAppearancePreview(null);
    setBackgroundPreview(null);
    setSettingsBackgroundSection(null);
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

  // --- Grid target-slot feedback (task 017-B) ---------------------------------
  // The resolved cells a live drag aims at, plus the live integer preview of
  // a resize. Reported only on integer-geometry changes; every gesture exit
  // path (cancel, invalidation, no-op, commit, unmount) reports null, and
  // the derived array below additionally gates on arrange — no effect-driven
  // clearing needed.
  const [dragTargetBoxes, setDragTargetBoxes] = useState<readonly GridItemGeometry[] | null>(null);
  const [resizeTargetBox, setResizeTargetBox] = useState<GridItemGeometry | null>(null);
  const gridFeedbackBoxes =
    arrange && displayPlacement !== null && displayPlacement.mode === "grid"
      ? [
          ...(dragTargetBoxes ?? []),
          ...(resizeTargetBox !== null ? [resizeTargetBox] : []),
        ]
      : undefined;

  const { dragging, handleDragStart, handleDragMove, handleDragEnd } = useCanvasDrag({
    placement: displayPlacement,
    metrics: freeformMetrics,
    pitchPx: gridMetrics?.pitchPx ?? null,
    onCommit: commitDraggedCanvas,
    onGridTargetChange: setDragTargetBoxes,
    getDragItemIds: useCallback(
      (sourceId: LayoutItemId) => resolveDragItemIds(sourceId, selectionRef.current),
      []
    ),
    resolveItemElement: useCallback((itemId: LayoutItemId) => {
      // Scoped to the ACTIVE page's own layer (021-R1): warm layers render
      // real items with the same data-item-id attributes, and a hidden
      // page's element must never win a document-wide lookup.
      const pageId = pageIdRef.current;
      const scope = menuAreaRef.current?.querySelector(
        scopedToLayer(pageId, `[data-item-id="${CSS.escape(itemId)}"]`) ?? ""
      );
      return scope instanceof HTMLElement ? scope : null;
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

  /**
   * Layer-stable context-menu entry point for section items: the identity
   * must never churn (warm layers memoize their props, 020-A2 §18), while
   * the menu is still built from the freshest render's state via the
   * latest-value mirror.
   */
  const openContextMenuRef = useRef(openContextMenu);
  useEffect(() => {
    openContextMenuRef.current = openContextMenu;
  });
  const handleEntityContextMenu = useCallback((entityId: EntityId, x: number, y: number) => {
    openContextMenuRef.current({ kind: "entity", entityId, source: "desktop", x, y });
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
      // Scoped to the interactive page's own layer (021-R1) — never a
      // document-wide attribute lookup that a warm or exiting layer could
      // win.
      const marqueePageId = pageIdRef.current;
      const viewport =
        marqueePageId === null
          ? null
          : menuAreaRef.current?.querySelector(
              [
                scopedToLayer(marqueePageId, ".vela-grid-stage"),
                scopedToLayer(marqueePageId, ".vela-canvas"),
              ].join(", ")
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
          onOpenSettings: openSettings,
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

  /** The mounted (warm) section pages, in workspace page order. */
  const mountedSectionLayers = useMemo(
    () => snapshot.pages.filter((page) => mountedSectionIds.includes(page.id)),
    [snapshot.pages, mountedSectionIds]
  );

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
  // During the overlay's EXIT the folder may already be closed: the last
  // OPENED folder (state, set by the open handler — never written during
  // render) keeps the fading surface rendering real content.
  const renderedOverlayFolder = overlayFolder ?? lastOverlayFolder;

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
    <VdPortalContainerProvider value={portalRoot}>
    <VdHeroOverlayScope>
    <div
      className="vela-desktop"
      data-vd-ui=""
      data-arrange={arrange ? "true" : "false"}
      data-vd-color-mode={effectiveColorMode}
      data-vd-wallpaper={theme.wallpaperPreset}
      data-has-dock={hasDock ? "true" : "false"}
      style={theme.style as CSSProperties}
    >
      {/* The full-desktop background layers (023-C): behind the rail,
          workspace and dock; pointer-transparent, clipped, at most two
          prepared surfaces with a restrained accepted-generation crossfade.
          The ambient drift stays its own decorative layer above it. */}
      <WorkspaceWallpaperLayers wallpaper={effectiveWallpaper} assetUrl={wallpaperAssetUrl} />
      <div className="vela-desktop__ambient" aria-hidden="true" ref={desktopAmbientRef} />
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
              The one section viewport (018, warm-layered in 020-A2): every
              MOUNTED section renders as a stable layer keyed by its page
              id — the active ±1 warm set. Only the active (and, during a
              transition, its exiting partner) is visible; hidden warm
              layers keep real geometry for measurement but never paint,
              take pointers or duplicate accessibility. A switch starts the
              pose-driven Motion transition on EXISTING subtrees — the
              destination is never built inside the transition commit.
              While a modal or a drag is up, data-scroll-locked freezes the
              active scroller without changing scrollTop.
            */}
            <div
              className="vela-section-viewport"
              ref={menuAreaRef}
              data-section-transitioning={
                sectionNavMachine.kind !== "idle" ? "true" : undefined
              }
              onContextMenu={handleAreaContextMenu}
            >
              {mountedSectionLayers.map((page) => (
                <SectionLayerSlot
                  key={page.id}
                  page={page}
                  machine={sectionNavMachine}
                  activePageId={effectiveActivePageId}
                  onLayerElement={registerSectionLayer}
                  displayPlacement={page.id === effectiveActivePageId ? displayPlacement : null}
                  renderedWorkspace={renderedSnapshot}
                  arrange={arrange}
                  dragEnabled={arrange && !handoffLock && !resizeLock}
                  scrollLocked={scrollLocked}
                  appearanceEditingId={appearanceEditingId}
                  metrics={freeformMetrics}
                  gridMetrics={gridMetrics}
                  canvasRef={canvasRef}
                  gridStageRef={gridStageRef}
                  selectedIds={selectedItemIds}
                  resizableIds={resizableIds}
                  resizeActiveId={resizeActiveId}
                  gridFeedbackBoxes={gridFeedbackBoxes}
                  initialScrollTop={sectionScrollMemory().recall(page.id)}
                  onResizeCommit={commitResizedGeometry}
                  onResizeSessionChange={handleResizeSessionChange}
                  onResizePreview={setResizeTargetBox}
                  onItemSelect={handleItemSelect}
                  onEntityContextMenu={handleEntityContextMenu}
                  onOpenFolder={openFolderOverlay}
                  onCanvasPointerDown={handleViewportPointerDown}
                  onCanvasPointerMove={handleViewportPointerMove}
                  onCanvasPointerUp={handleViewportPointerUp}
                />
              ))}
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
        workspace={renderedSnapshot}
        onOpenFolder={(folderId) => openFolderOverlay(folderId)}
        onEntityContextMenu={(entityId, x, y) =>
          openContextMenu({ kind: "entity", entityId, source: "dock", x, y })
        }
        onDesktopContextMenu={(x, y) => openContextMenu({ kind: "desktop", x, y })}
      />

      {renderedOverlayFolder !== null ? (
        <FolderOverlay
          open={overlayFolder !== undefined}
          folder={renderedOverlayFolder}
          workspace={renderedSnapshot}
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
      {appearanceSession !== null ? (
        <AppAppearanceInspector
          open={
            dialog !== null &&
            dialog.kind === "edit-visual" &&
            dialog.entityId === appearanceSession.appId
          }
          workspace={snapshot}
          appId={appearanceSession.appId}
          draft={appearanceSession.draft}
          onDraftChange={(draft) =>
            setAppearanceSession((current) => (current === null ? current : { ...current, draft }))
          }
          onCancel={() => {
            closeDialog();
            setAppearanceSession(null);
          }}
          onSaved={() => {
            // Panel exits; the session STAYS until the staged snapshot
            // carries the same projected app (handoff effect below) — the
            // desktop must never flash the pre-save appearance.
            closeDialog();
          }}
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

      {/*
        Open-driven overlay surfaces (022): the Launcher, Settings window
        and App Inspector stay mounted and own their presence, so a close
        intent plays the exit animation while focus/scroll semantics stand
        down coherently, reopening mid-exit retargets, and the subtree
        releases exactly once.
      */}
      <Launcher
        open={launcherOpen}
        entries={launcherEntries}
        appsById={launcherAppsById}
        onActivate={activateLauncherEntry}
        onClose={() => setLauncherOpen(false)}
      />

      <SettingsCenter
        open={settingsOpen}
        workspace={snapshot}
        onPreviewAppearance={setAppearancePreview}
        onSave={handleSettingsSave}
        onClose={closeSettings}
        backgroundEntrySectionId={settingsBackgroundSection}
        activeSectionId={effectiveActivePageId}
        onPreviewBackground={setBackgroundPreview}
      />
      </div>
    {/*
      The shared overlay portal root (018, 021-R1): a themed sibling of the
      desktop element — the same EFFECTIVE color mode and --vd-* variables —
      so every overlay portal (Radix dialogs/popovers/tooltips AND the
      HeroUI/React-Aria Select popup, routed here by VdHeroOverlayScope)
      inherits the workspace theme without a second provider. Empty and
      unpositioned; portalled overlays position themselves.
    */}
    <div
      ref={setPortalRoot}
      data-vd-ui=""
      data-vd-portal-root=""
      data-vd-color-mode={effectiveColorMode}
      style={theme.style as CSSProperties}
    />
    </VdHeroOverlayScope>
    </VdPortalContainerProvider>
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

interface SectionLayerSlotProps {
  readonly page: DesktopPage;
  readonly machine: SectionNavMachine;
  readonly activePageId: DesktopPageId | null;
  /** Handoff-aware placement, passed ONLY for the logical active page. */
  readonly displayPlacement: PagePlacement | null;
  readonly renderedWorkspace: WorkspaceSnapshot;
  readonly arrange: boolean;
  readonly dragEnabled: boolean;
  readonly scrollLocked: boolean;
  readonly appearanceEditingId: EntityId | null;
  readonly metrics: CanvasPixelMetrics | null;
  readonly gridMetrics: SquareGridMetrics | null;
  readonly canvasRef: ((node: HTMLDivElement | null) => void) | undefined;
  readonly gridStageRef: ((node: HTMLDivElement | null) => void) | undefined;
  readonly selectedIds: ReadonlySet<EntityId>;
  readonly resizableIds: ReadonlySet<EntityId>;
  readonly resizeActiveId: EntityId | null;
  readonly gridFeedbackBoxes: readonly GridItemGeometry[] | undefined;
  readonly initialScrollTop: number | undefined;
  readonly onResizeCommit: (entityId: EntityId, geometry: ResizeCommitGeometry) => void;
  readonly onResizeSessionChange: (entityId: EntityId, active: boolean) => void;
  readonly onResizePreview: ((geometry: GridItemGeometry | null) => void) | undefined;
  readonly onItemSelect: (entityId: EntityId, toggle: boolean) => void;
  readonly onEntityContextMenu: (entityId: EntityId, x: number, y: number) => void;
  readonly onOpenFolder: (folderId: EntityId) => void;
  readonly onCanvasPointerDown?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onCanvasPointerMove?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  readonly onCanvasPointerUp?: ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined;
  /** Layer registration for the GSAP pair coordinator (task 022). */
  readonly onLayerElement: (pageId: DesktopPageId, node: HTMLElement | null) => void;
}

/**
 * One mounted section layer (020-A2): derives the layer's visual phase
 * from the pure navigation machine and gates the interactive surface
 * (measurement refs, gestures, selection, feedback) to the INTERACTIVE
 * section only — during a cold preparation the still-visible section stays
 * interactive while the hidden target measures. Memoized so a shell
 * re-render skips warm layers entirely; only machine events and this
 * page's own data re-render it (§18).
 */
const SectionLayerSlot = memo(function SectionLayerSlot({
  page,
  machine,
  activePageId,
  displayPlacement,
  renderedWorkspace,
  arrange,
  dragEnabled,
  scrollLocked,
  appearanceEditingId,
  metrics,
  gridMetrics,
  canvasRef,
  gridStageRef,
  selectedIds,
  resizableIds,
  resizeActiveId,
  gridFeedbackBoxes,
  initialScrollTop,
  onResizeCommit,
  onResizeSessionChange,
  onResizePreview,
  onItemSelect,
  onEntityContextMenu,
  onOpenFolder,
  onCanvasPointerDown,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onLayerElement,
}: SectionLayerSlotProps) {
  const phase = deriveLayerPhase(machine, page.id, activePageId);
  const interactive = page.id === interactiveActiveIdOf(machine, activePageId);
  const ownPlacement = useMemo(() => resolvePagePlacement(page), [page]);
  const placement =
    page.id === activePageId && displayPlacement !== null ? displayPlacement : ownPlacement;
  return (
    <SectionLayer
      page={page}
      phase={phase}
      onLayerElement={onLayerElement}
    >
      <SectionView
        placement={placement}
        workspace={renderedWorkspace}
        active={interactive}
        appearanceEditingId={interactive ? appearanceEditingId : null}
        arrange={arrange}
        dragEnabled={dragEnabled}
        scrollLocked={scrollLocked}
        initialScrollTop={initialScrollTop}
        metrics={metrics}
        gridMetrics={gridMetrics}
        canvasRef={interactive ? canvasRef : undefined}
        gridStageRef={interactive ? gridStageRef : undefined}
        selectedIds={interactive ? selectedIds : EMPTY_ID_SET}
        resizableIds={interactive ? resizableIds : EMPTY_ID_SET}
        resizeActiveId={interactive ? resizeActiveId : null}
        onResizeCommit={onResizeCommit}
        onResizeSessionChange={onResizeSessionChange}
        onResizePreview={interactive ? onResizePreview : undefined}
        gridFeedbackBoxes={interactive ? gridFeedbackBoxes : undefined}
        onItemSelect={onItemSelect}
        onEntityContextMenu={onEntityContextMenu}
        onOpenFolder={onOpenFolder}
        onCanvasPointerDown={interactive ? onCanvasPointerDown : undefined}
        onCanvasPointerMove={interactive ? onCanvasPointerMove : undefined}
        onCanvasPointerUp={interactive ? onCanvasPointerUp : undefined}
      />
    </SectionLayer>
  );
});

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
