"use client";

import { useVdSmoothScroll } from "@components/vd/smooth-scroll";
import { useVdScrollbar } from "@components/vd/use-vd-scrollbar";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  VdHeroOverlayScope,
  VdPortalContainerProvider,
} from "@components/ui/overlay-scope";
import { useVdReducedMotion } from "@components/vd/reduced-motion";
import {
  captureDeletedAppEntry,
  deleteApp,
  deleteEmptyPage,
  findDesktopPage,
  movePage,
  pageItemIds,
  resolveModeAwareWallpaper,
  resolveWorkspaceAppearance,
  restoreDeletedApp,
} from "@veladesk/domain";
import type {
  AppShortcut,
  DeletedAppRestoreEntry,
  DesktopPage,
  DesktopPageId,
  EntityId,
  WorkspaceSnapshot,
} from "@veladesk/domain";
import type { LocalWorkspaceRecord } from "@veladesk/local-store";
import type { WorkspaceRuntimeRemoteResult } from "@veladesk/client-runtime";

import { useWorkspaceRuntimeInstance } from "../../workspace-runtime/use-workspace-runtime";
import { useWallpaperAssetUrl } from "../desktop-wallpaper";
import { SceneBackdrop } from "../scene/scene-backdrop";
import { buildAppearanceTheme, resolveEffectiveColorMode } from "../appearance-theme";
import { useSystemPrefersLight } from "../use-system-prefers-light";
import { useDocumentColorScheme } from "../use-document-color-scheme";
import { getBrowserAssetRuntime } from "../../assets/browser-assets";
import { useI18n } from "../../i18n/use-i18n";
import { launchApp } from "../launch-app";
import { resolveDockEntities } from "../dock-model";
import { stageWorkspaceAndTrySync } from "../workspace-commit";
import { resolveSectionAfterDelete } from "../section-navigation-model";
import { AddAppDialog } from "../add-app-dialog";
import { ConfirmDialog } from "../confirm-dialog";
import { EditAppDialog } from "../edit-app-dialog";
import { MoveToSectionDialog } from "../move-to-section-dialog";
import { SectionDialog } from "../section-dialog";
import { MotionToast, MotionToastStack } from "../motion-toast";
import type { WorkspaceActiveSection } from "../workspace-active-section";
import { resolveMobileSectionItems } from "./mobile-section-items";
import { swipePaneSlots } from "./mobile-swipe-model";
import { useSectionSwipe } from "./use-mobile-section-swipe";
import { MobileHeader } from "./mobile-header";
import { HelmClock } from "../shell/helm-clock";
import { MobileCategoryTabs, MOBILE_SECTION_PANEL_ID } from "./mobile-category-tabs";
import { MobileAppGrid } from "./mobile-app-grid";
import { MobileDock } from "./mobile-dock";
import { MobileSearch } from "./mobile-search";
import { MobileFolderSheet } from "./mobile-folder-sheet";
import { MobileManageSections } from "./mobile-manage-sections";
import { MobileMenuSheet } from "./mobile-menu-sheet";
import { MobileTileMenu } from "./mobile-tile-menu";
import "./mobile-shell.css";

/**
 * One mobile edit surface at a time (UX-12). The sheets/menus are mobile
 * surfaces; everything else names the SHARED desktop dialog that renders
 * for it (the dialogs own their own staging + validation).
 */
type MobileEditSurface =
  | { readonly kind: "tile-menu"; readonly appId: EntityId }
  | { readonly kind: "edit-app"; readonly appId: EntityId }
  | { readonly kind: "add-app" }
  | { readonly kind: "move-app"; readonly appId: EntityId }
  | { readonly kind: "delete-app"; readonly appId: EntityId }
  | { readonly kind: "manage-sections" }
  | { readonly kind: "new-section" }
  | { readonly kind: "rename-section"; readonly pageId: DesktopPageId }
  | { readonly kind: "delete-section"; readonly pageId: DesktopPageId };

/**
 * The mobile companion shell (task 026): VelaDesk's phone surface —
 * browse sections, launch apps, open folders, search, use the dock, plus
 * the MINIMAL edit path (UX-12: long-press tile menu, drawer 添加应用 /
 * 管理分区, empty-section add button). It shares the workspace runtime,
 * data, wallpaper resolver, icons, search model, i18n and view-state with
 * the desktop; editing reuses the desktop's DIALOGS verbatim (same domain
 * ops, same URL gate, same delete-undo toast) while the desktop's
 * authoring machinery (DnD, resize, arrange, settings) stays unmounted —
 * §28/§29.
 *
 * Layout (§11): themed root (data-vd-material like the desktop) → shared
 * scene backdrop (wallpaper + Dawn) → header → category tabs →
 * natively scrolling content (regular derived grid) → pinned dock, with a
 * themed portal sibling for the sheet surfaces. The active section comes
 * from the SHARED owner above the shell switch.
 */
export function MobileShell({
  workspace,
  lastRemoteResult,
  activeSection,
}: {
  readonly workspace: LocalWorkspaceRecord;
  readonly lastRemoteResult?: WorkspaceRuntimeRemoteResult | undefined;
  readonly activeSection: WorkspaceActiveSection;
}) {
  const snapshot = workspace.snapshot;
  const runtime = useWorkspaceRuntimeInstance();
  const reducedMotion = useVdReducedMotion();
  const scrollRef = useRef<HTMLElement | null>(null);
  useVdScrollbar(scrollRef, "y");
  useVdSmoothScroll(scrollRef, true);
  const { locale, t } = useI18n();

  /** Latest-value mirror for the async edit handlers. */
  const workspaceRef = useRef(workspace);
  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  // --- Theme (shared resolver, no mobile preview state — §49) --------------
  const resolvedAppearance = useMemo(
    () => resolveWorkspaceAppearance(snapshot.preferences),
    [snapshot.preferences],
  );
  const theme = useMemo(() => buildAppearanceTheme(resolvedAppearance), [resolvedAppearance]);
  const systemPrefersLight = useSystemPrefersLight();
  const effectiveColorMode = resolveEffectiveColorMode(theme.colorMode, systemPrefersLight);
  useDocumentColorScheme(effectiveColorMode);

  // --- Active section (shared owner; wallpaper follows it — §43/§44) -------
  const activePageId = activeSection.effectiveActivePageId;
  const activePage =
    activePageId === null ? undefined : findDesktopPage(snapshot, activePageId);
  const effectiveWallpaper = useMemo(
    () =>
      // Mode-aware (P1): the effective color mode's page override first,
      // then the ordinary page → workspace → preset chain.
      resolveModeAwareWallpaper(
        { effectiveMode: effectiveColorMode, page: activePage, modeWallpaperDraft: undefined },
        {
          page: activePage,
          pageWallpaperDraft: undefined,
          pageWallpaperExplicitlyInherits: false,
          workspaceWallpaper: resolvedAppearance.wallpaper,
          workspaceDraft: undefined,
          legacyWorkspacePreset: resolvedAppearance.wallpaperPreset,
        },
      ),
    [activePage, resolvedAppearance, effectiveColorMode],
  );
  const wallpaperAssetId =
    effectiveWallpaper.config.kind === "asset" ? effectiveWallpaper.config.assetId : null;
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
  const wallpaperAssetUrl = useWallpaperAssetUrl(wallpaperAssetId, loadWallpaperAsset);

  // --- The section's consumable items (derived per pane, never persisted) ---
  // No memo: the resolver is a cheap sort+map over one page's items, and the
  // pane list changes identity every switch anyway (§20: stable entity keys).
  const hasDock = useMemo(() => resolveDockEntities(snapshot).length > 0, [snapshot]);

  // --- Consumption surfaces (session state only) ---------------------------
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [folderId, setFolderId] = useState<EntityId | null>(null);

  // --- The minimal edit path (UX-12) ----------------------------------------
  // One surface at a time. Sheets (tile menu, manage sections) are mobile
  // surfaces; every dialog kind renders the DESKTOP's shared dialog for
  // the operation — one code path for validation, staging and undo.
  const [surface, setSurface] = useState<MobileEditSurface | null>(null);
  /** Inline error surface for the confirm dialogs (delete app/section). */
  const [surfaceError, setSurfaceError] = useState<string | null>(null);
  /**
   * The pending delete-undo (the UX-09 contract on mobile): the captured
   * restore entry of the most recent successful app delete, as a toast
   * with an 撤销 action for ~6 seconds.
   */
  const [deleteUndo, setDeleteUndo] = useState<{
    readonly entry: DeletedAppRestoreEntry;
    readonly occurrence: number;
  } | null>(null);

  function closeSurface(): void {
    setSurface(null);
    setSurfaceError(null);
  }

  const openAddApp = useCallback(() => {
    setSurface({ kind: "add-app" });
  }, []);

  async function handleDeleteApp(appId: EntityId): Promise<void> {
    const current = workspaceRef.current.snapshot;
    // Capture the undo entry BEFORE the immutable delete (UX-09).
    const entry = captureDeletedAppEntry(current, appId);
    const result = deleteApp(current, appId);
    if (!result.ok) {
      setSurfaceError(t("dialog.deleteApp.error.appGone"));
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setSurfaceError(t("dialog.deleteApp.error.failed"));
      return;
    }
    setSurface(null);
    if (entry !== null) {
      setDeleteUndo((current2) => ({ entry, occurrence: (current2?.occurrence ?? 0) + 1 }));
    }
  }

  function undoDeleteApp(entry: DeletedAppRestoreEntry): void {
    setDeleteUndo(null);
    void (async () => {
      const restored = restoreDeletedApp(workspaceRef.current.snapshot, entry);
      if (!restored.ok) {
        console.error(`VelaDesk: delete-undo was refused (${restored.reason})`);
        return;
      }
      const staged = await stageWorkspaceAndTrySync(runtime, restored.workspace);
      if (!staged.ok) {
        console.error(`VelaDesk: delete-undo was not staged (${staged.reason})`);
      }
    })();
  }

  async function handleDeleteSection(pageId: DesktopPageId): Promise<void> {
    const current = workspaceRef.current.snapshot;
    // The surviving neighbor is decided BEFORE the deletion so the switch
    // can never land on a page that no longer exists.
    const neighbor = resolveSectionAfterDelete(
      current.pages.map((page) => page.id),
      pageId,
    );
    const result = deleteEmptyPage(current, pageId);
    if (!result.ok) {
      setSurfaceError(
        result.reason === "page-not-found"
          ? t("dialog.deleteSection.error.sectionGone")
          : t("dialog.deleteSection.error.failed")
      );
      return;
    }
    const staged = await stageWorkspaceAndTrySync(runtime, result.workspace);
    if (!staged.ok) {
      setSurfaceError(t("dialog.deleteSection.error.failed"));
      return;
    }
    setSurface(null);
    if (neighbor !== null) {
      activeSection.requestActiveSection(neighbor);
    }
  }

  /** Reorder from the section manager — the sheet stays open (the list re-renders). */
  async function handleMoveSection(pageId: DesktopPageId, direction: "up" | "down"): Promise<void> {
    const result = movePage(workspaceRef.current.snapshot, pageId, direction);
    if (!result.ok) {
      return;
    }
    await stageWorkspaceAndTrySync(runtime, result.workspace);
  }

  // Section paging is now a SWIPE STRIP (previous | active | next, moved
  // as one transform). The old two-phase prepared-target coordinator is gone:
  // the neighbours are always mounted, so a swipe reveals content that is
  // already laid out. A tap keeps the short tab-content entrance.
  // The logical active section stays the single source of truth that the
  // tabs, the search sheet and persistence follow.

  const openApp = useCallback((app: AppShortcut) => {
    launchApp(app);
  }, []);

  /** The themed overlay portal root (sibling of the shell root — 018/021-R1). */
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement | null>(null);

  return (
    <VdPortalContainerProvider value={portalRoot}>
    <VdHeroOverlayScope>
    <div
      className="vela-mobile-shell"
      data-vd-ui=""
      data-vd-mobile-shell=""
      data-vd-color-mode={effectiveColorMode}
      data-vd-material={theme.materialTier}
      data-vd-wallpaper={theme.wallpaperPreset}
      data-has-dock={hasDock ? "true" : "false"}
      style={theme.style as CSSProperties}
    >
      {/* The SHARED scene backdrop (P1): wallpaper layers, the Dawn horizon
          on preset scenes, the ambient drift and the Dawn opening (default
          on, once per tab across both shells, static under reduced motion,
          never over a custom wallpaper). */}
      <SceneBackdrop
        wallpaper={effectiveWallpaper}
        assetUrl={wallpaperAssetUrl}
        wallpaperClassName="vela-mobile-shell__wallpaper"
      />
      <MobileHeader
        workspace={workspace}
        lastRemoteResult={lastRemoteResult}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenMenu={() => setMenuOpen(true)}
      />
      {/* The Helm clock's compact twin (Helm r2): the same landmark the
          desktop carries, shrunken — consumption stays glanceable without
          adding a control. */}
      <div className="vela-mobile-clockband" aria-hidden="true">
        <HelmClock locale={locale} variant="compact" />
      </div>
      <MobileCategoryTabs
        pages={snapshot.pages}
        activePageId={activePageId}
        onSelect={activeSection.requestActiveSection}
      />
      <main ref={scrollRef} data-vd-scroll="y" className="vela-mobile-shell__content" id={MOBILE_SECTION_PANEL_ID} role="tabpanel">
        <SectionSwipeStrip
          pages={snapshot.pages}
          activePageId={activePageId}
          reducedMotion={reducedMotion}
          onCommit={activeSection.requestActiveSection}
          renderPage={(pageId) => (
            <MobileAppGrid
              items={resolveMobileSectionItems({ workspace: snapshot, pageId })}
              workspace={snapshot}
              onOpenApp={openApp}
              onOpenFolder={setFolderId}
              onOpenAppMenu={(app) => setSurface({ kind: "tile-menu", appId: app.id })}
              onDismissAppMenu={() => setSurface(null)}
              onAddApp={pageId === activePageId ? openAddApp : undefined}
            />
          )}
        />
      </main>
      <MobileDock workspace={snapshot} onOpenApp={openApp} onOpenFolder={setFolderId} />

      <MobileSearch
        open={searchOpen}
        onOpenChange={setSearchOpen}
        workspace={snapshot}
        activePageId={activePageId}
        onOpenApp={openApp}
        onOpenFolder={(id) => {
          setSearchOpen(false);
          setFolderId(id);
        }}
        onSelectSection={(pageId: DesktopPageId) => {
          setSearchOpen(false);
          activeSection.requestActiveSection(pageId);
        }}
      />
      <MobileFolderSheet
        folderId={folderId}
        workspace={snapshot}
        onOpenApp={openApp}
        onFolderClosed={() => setFolderId(null)}
      />
      <MobileMenuSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        workspace={workspace}
        onAddApp={openAddApp}
        onManageSections={() => setSurface({ kind: "manage-sections" })}
      />

      {/*
        The minimal edit path (UX-12): mobile sheets for the menus, the
        DESKTOP's shared dialogs for the operations — one validation/staging
        path across shells, portalled to the mobile shell's themed root.
      */}
      {surface !== null && surface.kind === "tile-menu" ? (
        (() => {
          const app = snapshot.entities.find(
            (entity): entity is AppShortcut => entity.kind === "app" && entity.id === surface.appId,
          );
          if (app === undefined) {
            return null;
          }
          return (
            <MobileTileMenu
              appName={app.name}
              onOpenChange={(open) => {
                if (!open) {
                  closeSurface();
                }
              }}
              onEdit={() => setSurface({ kind: "edit-app", appId: app.id })}
              onMoveToSection={() => setSurface({ kind: "move-app", appId: app.id })}
              onDelete={() => setSurface({ kind: "delete-app", appId: app.id })}
            />
          );
        })()
      ) : null}
      {surface !== null && surface.kind === "edit-app" ? (
        <EditAppDialog
          workspace={snapshot}
          appId={surface.appId}
          onClose={closeSurface}
        />
      ) : null}
      {surface !== null && surface.kind === "add-app" && activePageId !== null ? (
        <AddAppDialog
          workspace={snapshot}
          destination={{ kind: "page", pageId: activePageId }}
          onClose={closeSurface}
        />
      ) : null}
      {surface !== null && surface.kind === "move-app" ? (
        <MoveToSectionDialog
          workspace={snapshot}
          appId={surface.appId}
          currentPageId={containerPageId(snapshot, surface.appId)}
          onClose={closeSurface}
        />
      ) : null}
      {surface !== null && surface.kind === "delete-app" ? (
        <ConfirmDialog
          title={t("dialog.deleteApp.title", {
            name:
              snapshot.entities.find(
                (entity): entity is AppShortcut => entity.kind === "app" && entity.id === surface.appId,
              )?.name ?? t("launcher.kind.app"),
          })}
          message={t("dialog.deleteApp.message")}
          confirmLabel={t("dialog.deleteApp.confirm")}
          error={surfaceError}
          onConfirm={() => void handleDeleteApp(surface.appId)}
          onCancel={closeSurface}
        />
      ) : null}
      {surface !== null && surface.kind === "manage-sections" ? (
        <MobileManageSections
          workspace={snapshot}
          onOpenChange={(open) => {
            if (!open) {
              closeSurface();
            }
          }}
          onCreate={() => setSurface({ kind: "new-section" })}
          onRename={(pageId) => setSurface({ kind: "rename-section", pageId })}
          onDelete={(pageId) => setSurface({ kind: "delete-section", pageId })}
          onMove={(pageId, direction) => void handleMoveSection(pageId, direction)}
        />
      ) : null}
      {surface !== null && (surface.kind === "new-section" || surface.kind === "rename-section") ? (
        <SectionDialog
          workspace={snapshot}
          gridSourcePage={activePage ?? snapshot.pages[0]!}
          section={
            surface.kind === "rename-section"
              ? findDesktopPage(snapshot, surface.pageId)
              : undefined
          }
          onCreated={(pageId) => {
            activeSection.requestActiveSection(pageId);
          }}
          onClose={closeSurface}
        />
      ) : null}
      {surface !== null && surface.kind === "delete-section" ? (
        <ConfirmDialog
          title={t("dialog.deleteSection.title")}
          message={t("dialog.deleteSection.message")}
          confirmLabel={t("dialog.deleteSection.confirm")}
          error={surfaceError}
          onConfirm={() => void handleDeleteSection(surface.pageId)}
          onCancel={closeSurface}
        />
      ) : null}

      {/*
        The delete-undo toast (the UX-09 contract on mobile): 「已删除「{name}」」+
        撤销 for ~6s. Reduced motion settles it instantly (MotionToast's
        own contract).
      */}
      <MotionToastStack>
        {deleteUndo !== null ? (
          <MotionToast
            key={deleteUndo.occurrence}
            lifetime={6000}
            slot="workspace"
            onDismiss={() => setDeleteUndo(null)}
            action={{
              label: t("common.undo"),
              onAction: () => undoDeleteApp(deleteUndo.entry),
            }}
          >
            {t("toast.appDeleted", { name: deleteUndo.entry.app.name })}
          </MotionToast>
        ) : null}
      </MotionToastStack>
    </div>
    <div
      ref={setPortalRoot}
      data-vd-ui=""
      data-vd-portal-root=""
      data-vd-color-mode={effectiveColorMode}
      data-vd-material={theme.materialTier}
      style={theme.style as CSSProperties}
    />
    </VdHeroOverlayScope>
    </VdPortalContainerProvider>
  );
}

/**
 * The page whose canvas currently holds this entity, when any (the same
 * derivation the desktop menus use — kept local so the mobile chunk never
 * imports the desktop menu layer for it).
 */
function containerPageId(
  workspace: WorkspaceSnapshot,
  entityId: EntityId,
): DesktopPageId | null {
  const page = workspace.pages.find((candidate) => pageItemIds(candidate).includes(entityId));
  return page?.id ?? null;
}

/**
 * The swipe strip (mobile category paging): the active page in flow, the
 * previous/next pages parked one viewport to either side, all translated
 * horizontally as one compositor layer.
 *
 * Why a strip instead of the old two-phase prepared-target machinery: the
 * gesture needs the neighbour to be VISIBLE while the finger moves, so both
 * neighbours stay mounted and laid out. Re-slotting happens only when the
 * active page actually changes, so mid-swipe React re-renders are exactly
 * zero — the finger only touches a transform.
 *
 * The loop is seam-free because the panes are IDENTIFIED BY PAGE ID: when a
 * swipe commits, the pane the user is already looking at simply becomes the
 * centre slot (same DOM node, no remount, no flash).
 * With a single section there are no neighbours and no looping.
 */
function SectionSwipeStrip({
  pages,
  activePageId,
  reducedMotion,
  onCommit,
  renderPage,
}: {
  readonly pages: readonly DesktopPage[];
  readonly activePageId: DesktopPageId | null;
  readonly reducedMotion: boolean;
  readonly onCommit: (pageId: DesktopPageId) => void;
  readonly renderPage: (pageId: DesktopPageId) => React.ReactNode;
}) {
  const pageIds = useMemo(() => pages.map((page) => page.id), [pages]);
  const looping = pageIds.length > 1;
  const { stripRef, onPointerDown } = useSectionSwipe({
    pageIds,
    activePageId,
    onCommit,
    looping,
    reducedMotion,
  });

  const slots = useMemo(
    () => swipePaneSlots({ pageIds, activePageId, looping }),
    [pageIds, activePageId, looping],
  );

  return (
    <div
      ref={stripRef}
      className="vela-mobile-swipe-strip"
      data-swipe-looping={looping ? "true" : "false"}
      onPointerDown={onPointerDown}
    >
      {slots.map(({ pageId, slot, bothSides }) => (
        <div
          key={pageId}
          className="vela-mobile-swipe-slot"
          data-swipe-slot={slot}
          data-swipe-both-sides={bothSides ? "true" : undefined}
          data-section-id={pageId}
          inert={slot === 0 ? undefined : true}
          aria-hidden={slot === 0 ? undefined : "true"}
        >
          {renderPage(pageId)}
        </div>
      ))}
    </div>
  );
}
