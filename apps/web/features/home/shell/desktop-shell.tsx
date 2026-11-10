"use client";

import { DragDropProvider } from "@dnd-kit/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import {
  VdHeroOverlayScope,
  VdPortalContainerProvider,
} from "@components/ui/overlay-scope";
import { resolveGridGapPx, findDesktopPage } from "@veladesk/domain";
import type {
  DesktopPageId,
  WorkspaceAppearancePreferences,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../../workspace-runtime/use-workspace-runtime";
import { Dock } from "../dock";
import { SectionRail } from "../section-rail";
import { HelmHeader } from "./helm-header";
import { loadWorkspaceViewState } from "../workspace-view-state";
import type { WorkspaceViewStateV1 } from "../workspace-view-state";
import {
  useWorkspaceActiveSection,
  type WorkspaceActiveSection,
} from "../workspace-active-section";
import { handleAppearanceAppClick } from "../appearance-app-click";
import { openAppearanceSession } from "../app-appearance-session";
import type { AppAppearanceSession } from "../app-appearance-session";
import { useI18n } from "../../i18n/use-i18n";
import { useWorkspaceManager } from "../workspace-manager";
import type { ContextMenuState } from "../context-menu";
import type { BackgroundPreview } from "../desktop-wallpaper";
import { SceneBackdrop } from "../scene/scene-backdrop";
import { WakeTrail } from "../scene/wake-trail";
import { useDesktopScene } from "../scene/use-desktop-scene";
import { useTileSession, EMPTY_SELECTION } from "../tile-host/use-tile-session";
import { useDesktopShortcuts } from "./use-desktop-shortcuts";
import { useShellDialogs } from "./use-shell-dialogs";
import { useShellSettings } from "./use-shell-settings";
import { useDesktopMenus } from "./use-desktop-menus";
import { useShellTheme } from "./use-shell-theme";
import { useBeforeWorkspaceChangeGuard } from "./use-before-change-guard";
import { useLauncherModel } from "./use-launcher-model";
import { useAppearanceProjection } from "./use-appearance-projection";
import { ShellWorkspace } from "./shell-workspace";
import { NoPagesFallback } from "./no-pages-fallback";
import { ShellContextProvider, useShellContextValue } from "./shell-context";
import type {
  DesktopMode,
} from "./shell-context";
import { ShellSurfaces } from "./shell-surfaces";
import { StaticDropFeedback } from "./static-drop-feedback";
import "../home-shell.css";

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
 * The ready-state production desktop (task 017), split into three layers
 * (P1-ENG-1): the SHELL (this file) composes the fixed app frame, owns
 * every surface's open/close state and hosts the keyboard layer; the
 * SCENE (../scene) owns the wallpaper and the section-switch
 * choreography; the TILE HOST (../tile-host) owns one section's tiles,
 * gestures and geometry commits. The feature root's desktop-shell.tsx
 * re-exports this component unchanged.
 *
 * The ACTIVE SECTION is explicit session state (never scroll-position
 * derived); switching sections plays a whole-page vertical transition and
 * remembers each section's scrollTop in session state. Sections place
 * their items in Grid (responsive square cells, unbounded rows) or
 * Freeform (continuous rects) mode, resolved through the domain's
 * canonical v2 placement resolver. Local-first editing: every edit runs a
 * pure operation, stages the resulting snapshot immediately, then fires an
 * explicit sync. Arrange mode belongs to the ACTIVE section only —
 * selection, drags, nudges and the per-page history never cross sections.
 */
export function DesktopShell({ workspace, lastRemoteResult, activeSection: externalActiveSection }: DesktopShellProps) {
  const runtime = useWorkspaceRuntimeInstance();
  const workspaceManager = useWorkspaceManager();
  const { locale, t } = useI18n();
  const snapshot = workspace.snapshot;

  const [mode, setMode] = useState<DesktopMode>(() =>
    snapshot.preferences.layoutLocked ? "view" : "arrange"
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [appearancePreview, setAppearancePreview] = useState<WorkspaceAppearancePreferences | null>(null);
  /**
   * Live background draft preview (023-C): ONE scope-keyed layer fed by the
   * Settings background editor — the workspace layer or the ACTIVE
   * section's layer, exactly what the resolver substitutes. Cleared on
   * Cancel/close and after a successful Save (the snapshot then carries the
   * same config, so there is no flash-back).
   */
  const [backgroundPreview, setBackgroundPreview] = useState<BackgroundPreview | null>(null);
  /** The section whose context menu opened Settings (its scope preselected). */
  const [settingsBackgroundSection, setSettingsBackgroundSection] = useState<DesktopPageId | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
   * The scene's DOM scroll capture, invoked by the shared active-section
   * hook at every flush boundary. The scene hook is declared below (it
   * needs this hook's controller), so the delegate reads the latest
   * closure through this mirror — the same latest-value pattern the hook
   * itself uses for `captureActiveScroll`.
   */
  const captureActiveScrollRef = useRef<() => void>(() => {});

  /**
   * The ACTIVE SECTION owner (026 §17): the shared minimal controller,
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
    captureActiveScroll: useCallback(() => captureActiveScrollRef.current(), []),
  });
  const effectiveActivePageId = activeSection.effectiveActivePageId;

  // Latest-value mirrors for async/session callbacks (drag commit, keyboard
  // navigation) that must always see the current render's data.
  const workspaceRef = useRef(workspace);
  const pageIdRef = useRef<DesktopPageId | null>(effectiveActivePageId);
  /** The section viewport element — shared by the scene and the tile host. */
  const menuAreaRef = useRef<HTMLDivElement | null>(null);
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

  const activePage =
    effectiveActivePageId !== null
      ? findDesktopPage(snapshot, effectiveActivePageId)
      : undefined;

  // The dialog/overlay session state, hoisted ahead of the appearance
  // projection (the inspector-open flag reads `dialog`) and of the scene
  // (which renders the projection). Pure state + handlers, no effects.
  const dialogs = useShellDialogs({
    runtime,
    t,
    pageIds,
    snapshot,
    effectiveActivePageId,
    workspaceRef,
    pendingRevealRef,
  });
  const {
    dialog,
    overlayFolderId,
    setDialog,
    openDialog,
    openFolderOverlay,
  } = dialogs;

  const inspectorOpen = dialog !== null && dialog.kind === "edit-visual";
  // The appearance projection (persisted + session draft through ONE
  // canonical projection — see use-appearance-projection.ts).
  const { renderedSnapshot, appearanceEditingId } = useAppearanceProjection({
    appearanceSession,
    inspectorOpen,
    snapshot,
  });

  // The rendered theme (preview ?? persisted) and the EFFECTIVE color mode
  // — one derivation, in use-shell-theme.ts.
  const { resolvedAppearance, theme, effectiveColorMode } = useShellTheme({
    appearancePreview,
    preferences: snapshot.preferences,
  });

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

  const arrange = mode === "arrange";

  // --- The three layers ------------------------------------------------------
  // Tile host first (the scene reads its resize lock); the scene next
  // (menus and shortcuts read its switchSection); the shell's own surface
  // session hooks follow.
  const tiles = useTileSession({
    runtime,
    snapshot,
    workspaceRef,
    pageIdRef,
    t,
    activePage,
    arrange,
    effectiveActivePageId,
    displayGapPx,
    viewportRef: menuAreaRef,
  });
  const scene = useDesktopScene({
    renderedSnapshot,
    workspacePages: snapshot.pages,
    backgroundPreview,
    resolvedAppearance,
    effectiveColorMode,
    activeSection,
    bootPersisted,
    viewportRef: menuAreaRef,
    pageIdRef,
    workspaceRef,
    resizeLockRef: tiles.commits.resizeLockRef,
  });
  const sceneCaptureActiveScroll = scene.captureActiveScroll;
  useEffect(() => {
    captureActiveScrollRef.current = sceneCaptureActiveScroll;
  }, [sceneCaptureActiveScroll]);

  // The launcher + dock model (entries follow the live snapshot).
  const { launcherEntries, launcherAppsById, hasDock } = useLauncherModel({
    snapshot,
    effectiveActivePageId,
    mode,
    syncState: workspace.syncState,
    locale,
    workspaceCandidates: workspaceManager === null ? null : workspaceManager.candidates,
  });

  const settings = useShellSettings({
    runtime,
    t,
    workspaceRef,
    layoutQueueRef: tiles.commits.layoutQueueRef,
    setContextMenu,
    setAppearancePreview,
    setBackgroundPreview,
    setSettingsBackgroundSection,
    setSettingsOpen,
    setPendingGapPx,
  });

  const menus = useDesktopMenus({
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
    switchSection: scene.switchSection,
    switchMode,
    setPlacementMode: tiles.commits.setPlacementMode,
    applyHistoryStep: tiles.commits.applyHistoryStep,
    commitResizedGeometry: tiles.commits.commitResizedGeometry,
    freeformBlockedReason: tiles.commits.freeformBlockedReason,
    arrangeHistoriesRef: tiles.commits.arrangeHistoriesRef,
    draggingRef: tiles.draggingRef,
    pendingHandoffRef: tiles.commits.pendingHandoffRef,
    pageIdRef,
    openDialog,
    openFolderOverlay,
    setLauncherOpen,
    setAppearanceSession,
    openSettings: settings.openSettings,
    openSectionBackgroundSettings: settings.openSectionBackgroundSettings,
    pendingRevealRef,
  });

  function switchMode(next: DesktopMode) {
    // A pending handoff means the display canvas outruns the durable
    // snapshot — mode changes wait the few ms until the stage lands. A live
    // resize owns the desktop entirely.
    if (tiles.commits.pendingHandoffRef.current !== null || tiles.commits.resizeLockRef.current) {
      return;
    }
    setMode(next);
    // Leaving arrange clears the session selection; re-entering arrange
    // starts fresh (the per-page history survives the round-trip).
    if (next === "view") {
      tiles.applySelection(EMPTY_SELECTION);
    }
  }

  // --- Context menu surface ----------------------------------------------------
  // While anything modal/drag-ish is up, the active section scroller must
  // not scroll (native CSS lock — no wheel parsing on the content path).
  const scrollLocked =
    tiles.dragging ||
    tiles.commits.handoffLock ||
    tiles.commits.resizeLock ||
    settingsOpen ||
    launcherOpen ||
    dialog !== null ||
    contextMenu !== null ||
    overlayFolderId !== null;

  /** Wheel navigation over the rail stands down while anything owns the desktop. */
  const railNavigationLocked = scrollLocked;

  // The before-workspace-change guard (use-before-change-guard.ts): a
  // workspace switch waits out drags, resizes, open surfaces, the layout
  // commit queue and pending geometry handoffs.
  useBeforeWorkspaceChangeGuard({
    runtime,
    dialog,
    settingsOpen,
    t,
    draggingRef: tiles.draggingRef,
    resizeLockRef: tiles.commits.resizeLockRef,
    layoutQueueRef: tiles.commits.layoutQueueRef,
    pendingHandoffRef: tiles.commits.pendingHandoffRef,
  });

  useDesktopShortcuts({
    arrange,
    contextMenu,
    dialog,
    overlayFolderId,
    launcherOpen,
    settingsOpen,
    dragging: tiles.dragging,
    activePage,
    setLauncherOpen,
    applySelection: tiles.applySelection,
    selectionRef: tiles.selectionRef,
    nudgeSelection: tiles.commits.nudgeSelection,
    applyHistoryStep: tiles.commits.applyHistoryStep,
    arrangeHistoriesRef: tiles.commits.arrangeHistoriesRef,
    pendingHandoffRef: tiles.commits.pendingHandoffRef,
    resizeLockRef: tiles.commits.resizeLockRef,
    pageIdRef,
    draggingRef: tiles.draggingRef,
  });

  const sceneSwitchSection = scene.switchSection;
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
    sceneSwitchSection(target, { animate: false });
  }, [sceneSwitchSection, snapshot.pages]);

  // --- The typed shell context (inter-layer seam) -----------------------------
  // Provided to every layer below the shell (scene components, tile layers,
  // future plugin tiles) — built and memoized in shell-context.tsx.
  const shellContextValue = useShellContextValue({
    activeSectionId: effectiveActivePageId,
    mode,
    reducedMotion: scene.reducedMotion,
    switchSection: scene.switchSection,
    switchMode,
    openDialog,
    openContextMenu: menus.openContextMenu,
    openFolderOverlay,
    setLauncherOpen,
    openSettings: settings.openSettings,
    openSectionBackgroundSettings: settings.openSectionBackgroundSettings,
    syncCurrent: () => void runtime.syncCurrent(),
  });

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
    menus.openDesktopCommandMenu(event.clientX, event.clientY);
  }

  if (activePage === undefined && pageIds.length === 0) {
    // Invariant violation (a workspace always has pages) — the calm,
    // inspectable fallback (no-pages-fallback.tsx); never crash the tab.
    return <NoPagesFallback />;
  }

  const pages = snapshot.pages;

  return (
    <VdPortalContainerProvider value={portalRoot}>
    <VdHeroOverlayScope>
    <ShellContextProvider value={shellContextValue}>
    <div
      onClickCapture={(event) => handleAppearanceAppClick(
        event, inspectorOpen, appearanceEditingId, snapshot.entities,
        (app) => {
          setAppearanceSession(openAppearanceSession(app));
          setDialog({ kind: "edit-visual", entityId: app.id });
        },
      )}
      className="vela-desktop"
      data-vd-ui=""
      data-inspector-open={inspectorOpen}
      data-arrange={arrange ? "true" : "false"}
      data-vd-color-mode={effectiveColorMode}
      data-vd-material={theme.materialTier}
      data-vd-wallpaper={theme.wallpaperPreset}
      data-has-dock={hasDock ? "true" : "false"}
      style={theme.style as CSSProperties}
    >
      <SceneBackdrop
        wallpaper={scene.effectiveWallpaper}
        assetUrl={scene.wallpaperAssetUrl}
      />
      {/* The Helm top landmark: clock + ⌘K command bar, over the scene and
          under nothing — pointer-transparent except the bar itself. */}
      <HelmHeader onOpenCommands={() => setLauncherOpen(true)} />
      {/* The Wake trail: only while a tile drag is live (the drag state the
          tile session already tracks). */}
      <WakeTrail active={tiles.dragging} />
      <DragDropProvider
        onDragStart={tiles.wrappedHandleDragStart}
        onDragMove={tiles.handleDragMove}
        onDragEnd={tiles.wrappedHandleDragEnd}
      >
        <StaticDropFeedback />
        <div className="vela-workbench">
          {/*
            The always-visible section rail (Helm r3): a REAL layout column
            beside the tiles — every section labelled, clickable, keyboard-
            and wheel-reachable with no hover, never overlapping content.
            Below 900px it becomes the horizontal section bar.
          */}
          <SectionRail
            pages={pages}
            activePageId={effectiveActivePageId}
            onSelectSection={(pageId) => scene.switchSection(pageId)}
            onSectionContextMenu={(pageId, x, y) => menus.openContextMenu({ kind: "section", pageId, x, y })}
            onOpenCommandMenu={(x, y) => menus.openContextMenu({ kind: "desktop", x, y })}
            navigationLocked={railNavigationLocked}
          />

          <ShellWorkspace
            arrange={arrange}
            activePage={activePage}
            effectiveActivePageId={effectiveActivePageId}
            renderedSnapshot={renderedSnapshot}
            workspace={workspace}
            lastRemoteResult={lastRemoteResult}
            displayGapPx={displayGapPx}
            scrollLocked={scrollLocked}
            appearanceEditingId={appearanceEditingId}
            pageIdRef={pageIdRef}
            viewportRef={menuAreaRef}
            scene={scene}
            tiles={tiles}
            onGridGapChange={settings.handleGridGapChange}
            onAreaContextMenu={handleAreaContextMenu}
            onEntityContextMenu={menus.openEntityContextMenu}
            onOpenFolder={openFolderOverlay}
          />
        </div>
      </DragDropProvider>

      {tiles.marquee !== null ? (
        <div
          className="vela-marquee"
          style={{
            left: Math.min(tiles.marquee.startX, tiles.marquee.currentX),
            top: Math.min(tiles.marquee.startY, tiles.marquee.currentY),
            width: Math.abs(tiles.marquee.currentX - tiles.marquee.startX),
            height: Math.abs(tiles.marquee.currentY - tiles.marquee.startY),
          }}
        />
      ) : null}

      <Dock
        workspace={renderedSnapshot}
        onOpenFolder={(folderId) => openFolderOverlay(folderId)}
        onEntityContextMenu={(entityId, x, y) =>
          menus.openContextMenu({ kind: "entity", entityId, source: "dock", x, y })
        }
        onDesktopContextMenu={(x, y) => menus.openContextMenu({ kind: "desktop", x, y })}
      />

      <ShellSurfaces
        dialogs={dialogs}
        renderedSnapshot={renderedSnapshot}
        snapshot={snapshot}
        pages={pages}
        activePage={activePage}
        effectiveActivePageId={effectiveActivePageId}
        pendingRevealRef={pendingRevealRef}
        appearanceSession={appearanceSession}
        setAppearanceSession={setAppearanceSession}
        containerPageId={menus.containerPageId}
        contextMenu={contextMenu}
        setContextMenu={setContextMenu}
        launcherOpen={launcherOpen}
        launcherEntries={launcherEntries}
        launcherAppsById={launcherAppsById}
        activateLauncherEntry={menus.activateLauncherEntry}
        setLauncherOpen={setLauncherOpen}
        settingsOpen={settingsOpen}
        handleSettingsSave={settings.handleSettingsSave}
        closeSettings={settings.closeSettings}
        settingsBackgroundSection={settingsBackgroundSection}
        setAppearancePreview={setAppearancePreview}
        setBackgroundPreview={setBackgroundPreview}
        openContextMenu={menus.openContextMenu}
        t={t}
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
      data-vd-material={theme.materialTier}
      style={theme.style as CSSProperties}
    />
    </ShellContextProvider>
    </VdHeroOverlayScope>
    </VdPortalContainerProvider>
  );
}
